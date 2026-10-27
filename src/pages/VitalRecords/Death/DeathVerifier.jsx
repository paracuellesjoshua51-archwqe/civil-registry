import React from "react";
import VitalRegistry from "../../../components/VitalRegistry/VitalRegistry";
import { deathConfig } from "../../../components/VitalRegistry/configs/deathConfig";

export default function UnifiedDeathRegistry({ initialView = null }) {
  return <VitalRegistry config={deathConfig} initialView={initialView} />;
}