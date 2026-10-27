import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

supabase
  .channel("document-tracking")
  .on("broadcast", { event: "changed" }, (msg) => {
    console.log(new Date().toLocaleTimeString(), "SIGNAL:", msg.payload);
  })
  .subscribe((status) => {
    console.log("STATUS:", status);
  });

console.log("Listening... (Ctrl+C to stop)");