import React from "react";
import VitalRegistry from "../../../components/VitalRegistry/VitalRegistry";
import { marriageConfig } from "../../../components/VitalRegistry/configs/marriageConfig";

export default function UnifiedMarriageRegistry({ initialView = null }) {
  return <VitalRegistry config={marriageConfig} initialView={initialView} />;
}