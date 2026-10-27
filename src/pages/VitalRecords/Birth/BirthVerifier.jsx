import React from "react";
import VitalRegistry from "../../../components/VitalRegistry/VitalRegistry";
import { birthConfig } from "../../../components/VitalRegistry/configs/birthConfig";

export default function UnifiedBirthRegistry({ initialView = null }) {
  return <VitalRegistry config={birthConfig} initialView={initialView} />;
}