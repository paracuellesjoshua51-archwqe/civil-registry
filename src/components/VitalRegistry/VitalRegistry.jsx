import React, { useEffect, useState } from "react";
import "../../pages/VitalRecords/VitalRecords.css";
import "./VitalRegistry.css";

import AccuracyBadge from "../AccuracyBadge";
import { SkeletonTable } from "../Skeleton";
import UploadRecordsModal from "../UploadRecordsModal";
import { apiFetch } from "../../services/apiFetch";
import { useRegisterRefresh } from "../../context/RefreshContext";
import { useDataChanged } from "../../hooks/useDataChanged";
import { runBulkDelete } from "../../utils/bulkDelete";
import { isDbAvailable, checkNow } from "../../offline/connectivityService";
import { newOpId } from "../../offline/outboxQueue";
import { refreshOfflineCredential } from "../../offline/archivePassword";
import {
  useVitalData, loadPdfForRecord, deleteRecordSmart, queueUpload, queueTransaction,
} from "../../offline/vitalOffline";

import { useShowNotif, useViewport } from "./hooks";
import {
  FEE, formatDate, matchesWords, matchesLastName,
} from "./vitalFormat";
import { IconArchive, IconFolder, IconGrid, IconSearch, IconUpload, IconDocument } from "./icons";
import { ConfirmModal, NegCertInfoModal, PdfModal, PasswordGate } from "./vitalModals";
import { NegativeCertPreview, printNegativeCertificate } from "./negCertificate";
import { InlinePdfViewer, MobileRecordCard, RelativesChips, StepBar } from "./vitalPanels";

const ARCHIVE_DESCRIPTION =
  "The Archive section is restricted to authorized personnel. Enter the administrator password to upload, view, or delete records.";

const fileLabel = (r) => (r.file_name || "")
  .replace(/\.pdf$/i, "").replace(/[_,]+/g, " ").replace(/-+/g, " ");

/**
 * One registry screen for Birth, Death and Marriage. `config` supplies the
 * entity-specific names, wording, and transaction fields (see configs/).
 */
export default function VitalRegistry({ config, initialView = null }) {
  const { entity, api, copy, certificate: cert } = config;
  const moduleKey = `archive_${entity}`;

  const showNotif = useShowNotif();
  const { isMobile, useCards } = useViewport();

  const [tab, setTab] = useState(initialView === "archive" ? "archive" : "transaction");
  const [confirmModal, setConfirmModal] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [pdfModal, setPdfModal] = useState(null);
  const [negCertModal, setNegCertModal] = useState(null);
  const [negCertInfo, setNegCertInfo] = useState({ eventDate: "", father: "", mother: "", requestorName: "" });
  const [orNumber, setOrNumber] = useState("");

  const [step, setStep] = useState("select");
  const [srchFirstName, setSrchFirstName] = useState("");
  const [srchLastName, setSrchLastName] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [firstNameError, setFirstNameError] = useState("");
  const [lastNameError, setLastNameError] = useState("");
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [recordStatus, setRecordStatus] = useState(null);
  const [subjectName, setSubjectName] = useState("");
  const [payRef, setPayRef] = useState("");
  const [processing, setProcessing] = useState(false);

  const [step2, setStep2] = useState({ data: null, error: "" });
  const [step2Loading, setStep2Loading] = useState(false);
  const [previewLoadingId, setPreviewLoadingId] = useState(null);

  const [archiveSearch, setArchiveSearch] = useState("");
  const [archiveUnlocked, setArchiveUnlocked] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const { allRecords, allArchivedRecords, loadingRecords, fetchRecords, fetchArchived, online, snapshotStatus } =
    useVitalData({ entity, api, showNotif });

  useRegisterRefresh(async () => {
    const results = await Promise.all([fetchRecords(), fetchArchived()]);
    if (results.includes(false)) throw new Error(`Could not refresh ${copy.registryTitle}.`);
  });

  useDataChanged(() => {
    if (isDbAvailable()) { fetchRecords(); fetchArchived(); }
  }, { tables: config.liveTables, debounceMs: 750 });

  useEffect(() => {
    if (online) refreshOfflineCredential(moduleKey, api);
  }, [online, moduleKey, api]);

  /* ── search ── */

  const identityKey = (r) =>
    [config.nameOf(r), ...config.parentsOf(r).map((p) => p.text || "")].join("|").toUpperCase();
  const activeKeys = new Set(allRecords.map(identityKey));
  const allRecordsForSearch = [
    ...allRecords,
    ...allArchivedRecords
      .filter((r) => !activeKeys.has(identityKey(r)))
      .map((r) => ({ ...r, _isArchived: true })),
  ];

  const handleSearch = () => {
    let valid = true;
    if (!srchFirstName.trim()) { setFirstNameError("First name is required."); valid = false; } else setFirstNameError("");
    if (!srchLastName.trim()) { setLastNameError("Last name is required."); valid = false; } else setLastNameError("");
    if (valid) setHasSearched(true);
  };

  const searchFN = srchFirstName.trim().toUpperCase();
  const searchLN = srchLastName.trim().toUpperCase();
  const searchSpec = { lastName: srchLastName, firstName: srchFirstName };
  const accuracyFor = (r) => config.accuracyOf(r, searchSpec);

  const searchResults = hasSearched && searchLN
    ? allRecordsForSearch.filter((r) => matchesLastName(config.lastNamesOf(r), searchLN))
    : [];

  const sortedResults = [...searchResults].sort((a, b) => {
    if (!a._isArchived && b._isArchived) return -1;
    if (a._isArchived && !b._isArchived) return 1;
    const aExact = Boolean(searchFN) && config.firstNamesOf(a).includes(searchFN);
    const bExact = Boolean(searchFN) && config.firstNamesOf(b).includes(searchFN);
    if (aExact !== bExact) return aExact ? -1 : 1;
    const diff = accuracyFor(b) - accuracyFor(a);
    if (diff !== 0) return diff;
    return (config.firstNamesOf(a)[0] || "").localeCompare(config.firstNamesOf(b)[0] || "");
  });

  /* ── selection and negative certificate ── */

  const handleSelectFromSearch = (record) => {
    const name = config.subjectFor(record, srchLastName);
    setSelectedRecord(record);
    setRecordStatus("ACTIVE");
    setSubjectName(name);
    showNotif(`Selected: ${name}`, "success");
  };

  const openNegCertModal = () => {
    const who = `${srchFirstName.trim()} ${srchLastName.trim()}`.trim();
    setNegCertModal({ nameTerm: who, requestorName: who });
  };

  const handleNegCertModalSubmit = ({ eventDate, father, mother, requestorName }) => {
    const nameTerm = negCertModal.nameTerm;
    setNegCertModal(null);
    setNegCertInfo({ eventDate, father, mother, requestorName });
    setOrNumber("");
    setSelectedRecord(null);
    setRecordStatus("NOT_FOUND");
    setSubjectName(nameTerm);
    setStep2({ data: null, error: "" });
    showNotif(`Issuing Negative Certificate for "${nameTerm}"`, "success");
    setStep("payment");
  };

  /* ── PDF viewing ── */

  const openRecordPdf = async (id, record, { spinner = false } = {}) => {
    if (spinner) setPreviewLoadingId(id);
    try {
      const pdfData = await loadPdfForRecord(entity, api, id, record);
      setPdfModal({ pdfData, pdfError: null, fileName: config.nameOf(record) });
    } catch (err) {
      showNotif(err.message, "error");
    } finally {
      if (spinner) setPreviewLoadingId(null);
    }
  };

  const loadStep2Pdf = async (record) => {
    if (!record) { setStep2({ data: null, error: "" }); return; }
    setStep2Loading(true);
    try {
      setStep2({ data: await loadPdfForRecord(entity, api, record.id, record), error: "" });
    } catch (err) {
      showNotif(err.message, "error");
      setStep2({ data: null, error: err.message });
    } finally {
      setStep2Loading(false);
    }
  };

  const handleProceedToPayment = async () => {
    setStep("payment");
    if (selectedRecord) await loadStep2Pdf(selectedRecord);
    else setStep2({ data: null, error: "" });
  };

  /* ── payment step ── */

  const isPositive = recordStatus === "ACTIVE";
  const issuedDoc = isPositive ? copy.issuedPositive : copy.issuedNegative;
  const certData = {
    subjectName,
    eventDate: negCertInfo.eventDate,
    father: negCertInfo.father,
    mother: negCertInfo.mother,
    requestorName: negCertInfo.requestorName,
  };

  const handlePrintNegativeCert = () => {
    if (!orNumber.trim()) {
      showNotif("O.R. Number is required before printing the certificate.", "error");
      return;
    }
    printNegativeCertificate({
      copy: cert,
      data: { ...certData, eventDate: certData.eventDate || null, orNumber: orNumber.trim() },
    });
    showNotif("Printing Negative Certificate…", "success");
  };

  const handleConfirmPayment = () => {
    setPayRef("PAY-" + Date.now().toString().slice(-8));
    setStep("releasing");
    showNotif("Document reviewed. Proceeding to release.", "success");
  };

  // Resolves true only when the server confirmed the save, or it was queued on this device.
  const handleCompleteTransaction = async () => {
    setProcessing(true);
    const opId = newOpId();
    const url = `${api}/records/complete`;
    const payload = {
      searchOperator: subjectName,
      recordStatus,
      recordId: selectedRecord && !selectedRecord._pending ? selectedRecord.id : null,
      paymentMethod: "cash",
      paymentReference: payRef,
      paymentAmount: FEE,
      documentIssued: issuedDoc,
      orNumber: orNumber.trim() || null,
      ...config.transactionNames(selectedRecord, srchFirstName.trim(), srchLastName.trim()),
    };

    const saveOffline = async () => {
      await queueTransaction(entity, url, payload, subjectName, opId);
      showNotif("No connection. Transaction saved on this device and will sync automatically.", "success");
      return true;
    };

    try {
      if (!isDbAvailable()) return await saveOffline();

      let res;
      try {
        res = await apiFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Offline-Op-Id": opId },
          body: JSON.stringify(payload),
        });
      } catch {
        return await saveOffline();
      }
      if (res.status >= 500 && !(await checkNow())) return await saveOffline();

      let data = {};
      try { data = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok || data?.error) {
        throw new Error(data?.error || "Failed to save the transaction. Please try again.");
      }
      showNotif("Transaction completed successfully!", "success");
      return true;
    } catch (err) {
      showNotif(err.message || "Failed to save the transaction. Please try again.", "error");
      return false;
    } finally {
      setProcessing(false);
    }
  };

  const resetTransaction = () => {
    setStep("select");
    setSrchFirstName(""); setSrchLastName(""); setHasSearched(false);
    setFirstNameError(""); setLastNameError("");
    setSelectedRecord(null); setRecordStatus(null);
    setSubjectName(""); setPayRef("");
    setStep2({ data: null, error: "" });
    setNegCertInfo({ eventDate: "", father: "", mother: "", requestorName: "" });
    setOrNumber("");
    fetchRecords();
    fetchArchived();
  };

  /* ── archive: delete, bulk delete, selection ── */

  const handleDelete = (id, record) => {
    const name = config.nameOf(record);
    setConfirmModal({
      title: "Permanently Delete",
      message: <>Permanently delete <strong>"{name}"</strong>? This <strong>cannot be undone</strong>.</>,
      confirmLabel: "Delete",
      confirmColor: "#dc2626",
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const result = await deleteRecordSmart(entity, api, id, record, name);
          if (result === "queued") {
            showNotif(`"${name}" deleted offline. It will be removed from the server when you're back online.`, "success");
          } else if (result === "removed") {
            showNotif(`"${name}" removed from the upload queue.`, "success");
          } else {
            showNotif(`"${name}" deleted.`, "success");
            fetchArchived();
          }
        } catch (err) {
          showNotif(err.message, "error");
        }
      },
    });
  };

  const filteredArchived = archiveSearch.trim()
    ? allArchivedRecords.filter((r) =>
      matchesWords([...config.searchPartsOf(r), fileLabel(r)].join(" "), archiveSearch.trim()))
    : allArchivedRecords;

  const filteredIds = filteredArchived.map((r) => r.id);
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
  const someSelected = !allSelected && filteredIds.some((id) => selectedIds.has(id));

  const toggleSelect = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Select All only affects the rows currently visible (respects the search box).
  const toggleSelectAll = () => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (allSelected) filteredIds.forEach((id) => next.delete(id));
    else filteredIds.forEach((id) => next.add(id));
    return next;
  });

  const clearSelection = () => setSelectedIds(new Set());

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(allArchivedRecords.map((r) => r.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [allArchivedRecords]);

  const handleBulkDelete = () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const byId = new Map(allArchivedRecords.map((r) => [r.id, r]));
    const n = ids.length;
    const plural = n !== 1 ? "s" : "";

    setConfirmModal({
      title: "Permanently Delete Selected",
      message: <>Permanently delete <strong>{n} record{plural}</strong>? This <strong>cannot be undone</strong>.</>,
      confirmLabel: `Delete ${n}`,
      confirmColor: "#dc2626",
      onConfirm: async () => {
        setConfirmModal(null);
        setBulkDeleting(true);
        const result = await runBulkDelete({
          api,
          ids,
          byId,
          deleteOne: (id, record) => deleteRecordSmart(entity, api, id, record, config.nameOf(record)),
        });

        if (result.deleted > 0) {
          showNotif(`${result.deleted} record${result.deleted !== 1 ? "s" : ""} deleted.`, "success");
        }
        if (result.queued > 0) {
          showNotif(`${result.queued} will be removed when you're back online.`, "success");
        }
        if (result.failedIds.length > 0) {
          const f = result.failedIds.length;
          showNotif(
            `${f} record${f !== 1 ? "s" : ""} could not be deleted. They are still selected, so you can try again.`,
            "error",
          );
          setSelectedIds(new Set(result.failedIds));
        } else {
          clearSelection();
        }
        await fetchArchived();
        setBulkDeleting(false);
      },
    });
  };

  /* ── render ── */

  const archiveRowName = (r) => config.nameOf(r);
  const archiveDate = (r) => formatDate(r.archived_at);

  return (
    <div className="ubr-root">

      {confirmModal && <ConfirmModal {...confirmModal} onCancel={() => setConfirmModal(null)} />}

      {negCertModal && (
        <NegCertInfoModal
          subjectName={negCertModal.nameTerm}
          requestorName={negCertModal.requestorName}
          copy={cert}
          onSubmit={handleNegCertModalSubmit}
          onCancel={() => setNegCertModal(null)}
        />
      )}

      {pdfModal && (
        <PdfModal {...pdfModal} onClose={() => setPdfModal(null)} showNotif={showNotif} />
      )}

      {snapshotStatus === "no-snapshot" && (
        <div className="tbl-empty" role="status">
          Connect once to download offline data.
        </div>
      )}

      {showUploadModal && (
        <UploadRecordsModal
          section={entity}
          api={api}
          getRecordDisplayName={config.nameOf}
          queueOffline={(file) => queueUpload(entity, `${api}/records`, file)}
          allRecords={[...allRecords, ...allArchivedRecords]}
          showNotif={showNotif}
          onUploadSuccess={() => { fetchRecords(); fetchArchived(); }}
          onClose={() => setShowUploadModal(false)}
        />
      )}

      <div className="ubr-header">
        <div className="ubr-header__brand">
          <span className="ubr-header__logo"><IconGrid /></span>
          {!isMobile && <span className="ubr-header__title">{copy.registryTitle}</span>}
        </div>
        <div className="ubr-header__tabs">
          {[
            { key: "transaction", label: isMobile ? "Transaction" : "New Transaction" },
            { key: "archive", label: "Archive" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`ubr-tab-btn ubr-tab-btn--${tab === t.key ? "active" : "inactive"}`}
            >
              <span className="ubr-tab-btn__label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Transaction ── */}
      {tab === "transaction" && (
        <div className="ubr-body">
          <div className="ubr-tx">
            <StepBar current={step} />
            <div className="ubr-tx__scroll">
              <div className="ubr-card">

                {step === "select" && (
                  <>
                    <div className="step-scroll">
                      <div className="step-inner">
                        <div className="page-hdr">
                          <div className="page-hdr__title">{copy.searchTitle}</div>
                        </div>

                        <div className="search-form">
                          <div className="search-form__row">
                            <div className="field">
                              <label className="field-label" htmlFor={`${entity}-search-last-name`}>Last Name</label>
                              <input
                                id={`${entity}-search-last-name`}
                                name="lastName"
                                className={`field-input${lastNameError ? " field-input--error" : ""}`}
                                type="text"
                                autoComplete="family-name"
                                value={srchLastName}
                                onChange={(e) => {
                                  setSrchLastName(e.target.value);
                                  setHasSearched(false);
                                  if (e.target.value.trim()) setLastNameError("");
                                }}
                                onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
                                placeholder="e.g. Dela Cruz"
                                autoFocus
                              />
                              {lastNameError && <span className="field-error-msg">&#9888; {lastNameError}</span>}
                            </div>
                            <div className="field">
                              <label className="field-label" htmlFor={`${entity}-search-first-name`}>First Name</label>
                              <input
                                id={`${entity}-search-first-name`}
                                name="firstName"
                                className={`field-input${firstNameError ? " field-input--error" : ""}`}
                                type="text"
                                autoComplete="given-name"
                                value={srchFirstName}
                                onChange={(e) => {
                                  setSrchFirstName(e.target.value);
                                  setHasSearched(false);
                                  if (e.target.value.trim()) setFirstNameError("");
                                }}
                                onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
                                placeholder="e.g. Juan"
                              />
                              {firstNameError && <span className="field-error-msg">&#9888; {firstNameError}</span>}
                            </div>
                            <button className="search-btn" onClick={handleSearch}>Search</button>
                          </div>
                        </div>

                        {hasSearched && (
                          <div className="results-box">
                            <div className="results-hdr">
                              <div className="results-hdr__left">
                                <div className="results-hdr__count">
                                  {sortedResults.length} record{sortedResults.length !== 1 ? "s" : ""} found
                                  {sortedResults.some((r) => r._isArchived) && (
                                    <span className="results-hdr__archived-count">
                                      &nbsp;&middot;&nbsp;{sortedResults.filter((r) => r._isArchived).length} from archive
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {sortedResults.length === 0 ? (
                              <div className="no-results">
                                <p className="no-results__title">No records found for "{searchLN}"</p>
                                <button className="neg-btn" onClick={openNegCertModal}>
                                  Issue Negative Certificate
                                </button>
                              </div>
                            ) : (
                              <>
                                {sortedResults.map((r) => {
                                  const parents = config.parentsOf(r);
                                  const isLoadingPrev = previewLoadingId === r.id;
                                  const isSelected =
                                    selectedRecord?.id === r.id &&
                                    !!selectedRecord?._isArchived === !!r._isArchived;
                                  return (
                                    <div
                                      key={`${r._isArchived ? "arc" : "act"}-${r.id}`}
                                      className={[
                                        "result-row",
                                        isSelected ? "result-row--selected" : "",
                                        r._isArchived ? "result-row--archived" : "",
                                      ].filter(Boolean).join(" ")}
                                    >
                                      <div className="result-row__info">
                                        <div className="result-row__card-title">
                                          <span className="result-row__card-name">{config.nameOf(r)}</span>
                                          {r._isArchived && <span className="archived-badge">Archived</span>}
                                          <AccuracyBadge value={accuracyFor(r)} />
                                        </div>
                                        <div className="result-row__chips">
                                          {parents.filter((p) => p.text).map((p) => (
                                            <span key={p.tone} className={`result-chip result-chip--${p.tone}`}>{p.text}</span>
                                          ))}
                                          {!parents.some((p) => p.text) && (
                                            <span className="result-row__no-parent">{copy.noParentInfo}</span>
                                          )}
                                        </div>
                                      </div>

                                      <div className="result-row__actions">
                                        <button
                                          className="view-pdf-btn"
                                          onClick={() => openRecordPdf(r.id, r, { spinner: true })}
                                          disabled={isLoadingPrev}
                                          title={copy.viewTitle}
                                        >
                                          {isLoadingPrev
                                            ? <><div className="spinner spinner--sm" />&nbsp;Loading…</>
                                            : "View"}
                                        </button>
                                        <button
                                          className={`select-btn${isSelected ? " select-btn--selected" : ""}`}
                                          onClick={() => !isSelected && handleSelectFromSearch(r)}
                                        >
                                          {isSelected ? "Selected" : "Select →"}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                                <div className="no-match-alt">
                                  <span className="no-match-alt__text">Not the right person?</span>
                                  <button className="neg-btn neg-btn--inline" onClick={openNegCertModal}>
                                    Issue Negative Certificate
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="ubr-action-bar">
                      <button
                        className="btn btn-primary btn-proceed-compact"
                        onClick={handleProceedToPayment}
                        disabled={!selectedRecord && recordStatus !== "NOT_FOUND"}
                      >
                        Proceed →
                      </button>
                    </div>
                  </>
                )}

                {step === "payment" && (
                  <>
                    <div className="step-scroll">
                      <div className="step-inner step-inner--pdf">
                        <div className="page-hdr">
                          <div className="page-hdr__title">Review &amp; Print Document</div>
                          <p className="page-hdr__sub">
                            {isPositive
                              ? copy.reviewPositive
                              : "A Negative Certificate will be issued — no document on file for this record."}
                          </p>
                        </div>
                        {isPositive ? (
                          <InlinePdfViewer
                            pdfData={step2.data}
                            pdfError={step2.error}
                            loadingPdf={step2Loading}
                            displayName={selectedRecord ? config.nameOf(selectedRecord) : ""}
                            badge={copy.pdfBadge}
                            showNotif={showNotif}
                          />
                        ) : (
                          <NegativeCertPreview
                            copy={cert}
                            data={certData}
                            orNumber={orNumber}
                            onOrNumberChange={setOrNumber}
                            onPrint={handlePrintNegativeCert}
                          />
                        )}
                      </div>
                    </div>
                    <div className="ubr-action-bar">
                      <button className="btn btn-secondary btn-thick" onClick={() => setStep("select")}>← Back</button>
                      <button className="btn btn-primary btn-thick" onClick={handleConfirmPayment}>
                        Proceed to Release →
                      </button>
                    </div>
                  </>
                )}

                {step === "releasing" && (
                  <>
                    <div className="step-scroll">
                      <div className="step-inner step-inner--centered">
                        <div className="release-complete-wrap">
                          <div className="release-complete__ring">
                            <div className="release-complete__ring-inner">
                              <span className="release-complete__check">&#10003;</span>
                            </div>
                          </div>
                          <div className="release-complete__pct">100%</div>
                          <div className="release-complete__title">Request Complete</div>
                          <div className="release-complete__sub">
                            The document is ready for release to the requester.
                          </div>
                          <div className="release-complete__badge">
                            <span className="release-complete__badge-dot" />
                            Ready for Release
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="ubr-action-bar">
                      <button
                        className="btn btn-secondary btn-thick"
                        onClick={() => setStep("payment")}
                        disabled={processing}
                      >
                        ← Back
                      </button>
                      <button
                        className="btn btn-primary btn-primary--wide btn-thick"
                        onClick={async () => {
                          const saved = await handleCompleteTransaction();
                          if (saved) resetTransaction();
                        }}
                        disabled={processing}
                      >
                        {processing
                          ? <><div className="spinner spinner--sm" />&nbsp;Saving…</>
                          : "Release & New Transaction"}
                      </button>
                    </div>
                  </>
                )}

              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Archive ── */}
      {tab === "archive" && (
        <div className="tab-wrap">
          {!archiveUnlocked ? (
            <>
              <div className="tab-hdr">
                <div className="tab-hdr__icon"><IconArchive /></div>
                <div className="tab-hdr__info">
                  <h2>{copy.archiveTitle}</h2>
                  <p>Upload, view, or permanently delete archived records.</p>
                </div>
              </div>
              <div className="tab-card">
                <PasswordGate
                  module={moduleKey}
                  api={api}
                  description={ARCHIVE_DESCRIPTION}
                  onUnlock={() => setArchiveUnlocked(true)}
                  showNotif={showNotif}
                />
              </div>
            </>
          ) : (
            <>
              <div className="tab-hdr">
                <div className="tab-hdr__icon"><IconArchive /></div>
                <div className="tab-hdr__info">
                  <h2>Archived Records</h2>
                  {!isMobile && <p>Upload new records, or view and permanently delete archived records.</p>}
                </div>
                <div className="tab-hdr__space" />
                <button className="upload-btn" onClick={() => setShowUploadModal(true)}>
                  <IconUpload />
                  {isMobile ? "Upload" : "Upload PDF"}
                </button>
                <div className="srch-wrap">
                  <span className="srch-icon"><IconSearch /></span>
                  <input
                    id={`${entity}-archive-search`}
                    name="archiveSearch"
                    aria-label="Search archived records"
                    value={archiveSearch}
                    onChange={(e) => setArchiveSearch(e.target.value)}
                    placeholder="Search archived…"
                    className="srch-input"
                  />
                </div>
              </div>

              <div className="tab-card">
                {selectedIds.size > 0 && (
                  <div className="bulk-bar">
                    <span className="bulk-bar__count">{selectedIds.size} selected</span>
                    <div className="bulk-bar__acts">
                      <button className="bulk-bar__clear" onClick={clearSelection} disabled={bulkDeleting}>
                        Clear
                      </button>
                      <button
                        className="tbl-btn tbl-btn--red bulk-bar__delete"
                        onClick={handleBulkDelete}
                        disabled={bulkDeleting}
                      >
                        {bulkDeleting
                          ? <><div className="spinner spinner--sm spinner--white" />&nbsp;Deleting…</>
                          : `Delete Selected (${selectedIds.size})`}
                      </button>
                    </div>
                  </div>
                )}

                {loadingRecords ? (
                  <SkeletonTable rows={5} cols={4} />
                ) : filteredArchived.length === 0 ? (
                  <div className="tbl-empty">
                    <span className="tbl-empty__icon"><IconFolder /></span>
                    <div className="tbl-empty__title">No Archived Records Found</div>
                    <div className="tbl-empty__sub">
                      {archiveSearch
                        ? "No records match your search."
                        : "No records have been archived yet. Use the Upload button above to add new records."}
                    </div>
                  </div>
                ) : useCards ? (
                  <>
                    <label className="select-all-mobile">
                      <input
                        type="checkbox"
                        className="tbl-checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                        onChange={toggleSelectAll}
                      />
                      <span>Select all ({filteredArchived.length})</span>
                    </label>
                    <div className="mobile-records-list">
                      {filteredArchived.map((r, i) => (
                        <MobileRecordCard
                          key={r.id}
                          index={i}
                          name={archiveRowName(r)}
                          parents={config.parentsOf(r)}
                          date={archiveDate(r)}
                          selected={selectedIds.has(r.id)}
                          pending={r._pending}
                          onToggle={() => toggleSelect(r.id)}
                          onView={() => openRecordPdf(r.id, r)}
                          onDelete={() => handleDelete(r.id, r)}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th className="tbl-check-col">
                            <input
                              type="checkbox"
                              className="tbl-checkbox"
                              checked={allSelected}
                              ref={(el) => { if (el) el.indeterminate = someSelected; }}
                              onChange={toggleSelectAll}
                              title={allSelected ? "Unselect all" : "Select all"}
                              aria-label="Select all records"
                            />
                          </th>
                          <th>#</th>
                          <th>Name</th>
                          <th>{copy.parentsHeader}</th>
                          <th>Archived Date</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredArchived.map((r, i) => {
                          const checked = selectedIds.has(r.id);
                          return (
                            <tr key={r.id} className={checked ? "tbl-row--selected" : ""}>
                              <td className="tbl-check-col">
                                <input
                                  type="checkbox"
                                  className="tbl-checkbox"
                                  checked={checked}
                                  onChange={() => toggleSelect(r.id)}
                                  aria-label={`Select ${archiveRowName(r)}`}
                                />
                              </td>
                              <td className="tbl-num">{i + 1}</td>
                              <td>
                                <div className="tbl-file">
                                  <span className="tbl-file__icon"><IconDocument /></span>
                                  <span className="tbl-file-name">{archiveRowName(r)}</span>
                                  {r._pending && <span className="archived-badge">Pending sync</span>}
                                </div>
                              </td>
                              <td><RelativesChips parents={config.parentsOf(r)} /></td>
                              <td className="tbl-date">{archiveDate(r)}</td>
                              <td>
                                <div className="tbl-acts">
                                  <button className="tbl-btn tbl-btn--blue" onClick={() => openRecordPdf(r.id, r)}>View</button>
                                  <button className="tbl-btn tbl-btn--red" onClick={() => handleDelete(r.id, r)}>Delete</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}