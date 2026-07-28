import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const { driverProfileId, adminId, days, amount } = await req.json();
    if (!driverProfileId || !adminId || ![15, 30].includes(Number(days))) {
      return json({ error: "bad_request" }, 400);
    }

    const shopId = Deno.env.get("YOOKASSA_SHOP_ID");
    const secretKey = Deno.env.get("YOOKASSA_SECRET_KEY");
    const returnUrl = Deno.env.get("YOOKASSA_RETURN_URL") || "https://taxichi.pro";
    if (!shopId || !secretKey) return json({ error: "payment_not_configured" }, 503);

    const paymentAmount = Number(amount || 0);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) return json({ error: "bad_amount" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const idempotenceKey = crypto.randomUUID();
    const auth = btoa(`${shopId}:${secretKey}`);

    const yookassa = await fetch("https://api.yookassa.ru/v3/payments", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Idempotence-Key": idempotenceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: { value: paymentAmount.toFixed(2), currency: "RUB" },
        capture: true,
        confirmation: { type: "redirect", return_url: returnUrl },
        description: `Taxichi Pro подписка на ${days} дней`,
        metadata: { driverProfileId, adminId, days: String(days) },
      }),
    });

    const result = await yookassa.json();
    if (!yookassa.ok) return json({ error: "provider_error", details: result }, 502);

    await supabase.from("taxichi_payments").insert({
      driver_profile_id: driverProfileId,
      admin_id: adminId,
      provider_payment_id: result.id,
      amount: paymentAmount,
      status: result.status || "pending",
      days: Number(days),
      raw: result,
    });

    return json({ paymentId: result.id, confirmationUrl: result.confirmation?.confirmation_url || "" });
  } catch (error) {
    console.error(error);
    return json({ error: "server_error" }, 500);
  }
});
