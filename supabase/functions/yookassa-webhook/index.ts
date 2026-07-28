import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const event = await req.json();
  const payment = event.object || {};
  const metadata = payment.metadata || {};
  const paymentId = payment.id;
  const status = payment.status || "unknown";

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  await supabase.from("taxichi_payments")
    .update({ status, raw: event })
    .eq("provider_payment_id", paymentId);

  if (event.event === "payment.succeeded" && metadata.driverProfileId) {
    const days = Number(metadata.days || 0);
    const { data: profile } = await supabase
      .from("driver_profiles")
      .select("id,payload")
      .eq("id", metadata.driverProfileId)
      .maybeSingle();

    const payload = profile?.payload || {};
    const currentUntil = Date.parse(payload?.subscription?.paidUntil || "") || Date.now();
    const base = Math.max(currentUntil, Date.now());
    const paidUntil = addDays(new Date(base), days).toISOString();

    payload.subscription = {
      ...(payload.subscription || {}),
      isActive: true,
      paymentSource: "self",
      paidUntil,
      lastPaymentId: paymentId,
      updatedAt: new Date().toISOString(),
    };

    await supabase.from("driver_profiles")
      .update({ payload, admin_id: metadata.adminId || null })
      .eq("id", metadata.driverProfileId);

    await supabase.from("taxichi_audit_logs").insert({
      actor_type: "system",
      actor_id: "yookassa-webhook",
      admin_id: metadata.adminId || null,
      action: "subscription_paid",
      entity_table: "driver_profiles",
      entity_id: metadata.driverProfileId,
      details: { paymentId, days, paidUntil },
    });
  }

  return new Response("ok", { status: 200 });
});
