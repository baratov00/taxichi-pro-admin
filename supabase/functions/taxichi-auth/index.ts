import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const enc = new TextEncoder();
const dec = new TextDecoder();
const ITERATIONS = 210_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function bytesToB64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function b64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}

async function passwordHash(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, key, 256);
  return `pbkdf2$${ITERATIONS}$${bytesToB64(salt)}$${bytesToB64(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, storedHash?: string | null, legacyPassword?: string | null) {
  if (storedHash?.startsWith("pbkdf2$")) {
    const [, iterRaw, saltRaw, expectedRaw] = storedHash.split("$");
    const salt = b64ToBytes(saltRaw);
    const expected = expectedRaw || "";
    const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: Number(iterRaw), hash: "SHA-256" }, key, 256);
    return bytesToB64(new Uint8Array(bits)) === expected;
  }
  return String(legacyPassword || "") !== "" && String(legacyPassword || "") === String(password || "");
}

function phoneDigits(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function settings(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return typeof value === "object" ? value as Record<string, unknown> : {};
}

function safeAdmin(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name || "Админ",
    login: row.login || "",
    phone: row.phone || "",
    email: row.email || "",
    active: row.active !== false,
    payment_mode: row.payment_mode || "admin_balance",
    payment_provider: row.payment_provider || "none",
    payment_settings: row.payment_settings || {},
  };
}

function safeDirector(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name || "Директор",
    email: row.email || "",
    active: row.active !== false,
    can_manage_directors: row.can_manage_directors === true,
  };
}

async function createSession(supabase: ReturnType<typeof createClient>, actorType: string, actorId: string, req: Request) {
  const token = crypto.randomUUID() + "." + crypto.randomUUID();
  const token_hash = await sha256(token);
  const expires_at = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
  await supabase.from("taxichi_sessions").insert({
    actor_type: actorType,
    actor_id: actorId,
    token_hash,
    expires_at,
    user_agent: req.headers.get("user-agent") || "",
    ip: req.headers.get("x-forwarded-for") || "",
  });
  return { token, expires_at };
}

async function getSession(supabase: ReturnType<typeof createClient>, token: string, actorType: string) {
  const token_hash = await sha256(token || "");
  const { data } = await supabase
    .from("taxichi_sessions")
    .select("*")
    .eq("token_hash", token_hash)
    .eq("actor_type", actorType)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  return data;
}

async function logAttempt(supabase: ReturnType<typeof createClient>, req: Request, actorType: string, login: string, success: boolean, reason = "") {
  await supabase.from("taxichi_login_attempts").insert({
    actor_type: actorType,
    login,
    success,
    reason,
    user_agent: req.headers.get("user-agent") || "",
    ip: req.headers.get("x-forwarded-for") || "",
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = await req.json();
    const action = String(body.action || "");

    if (action === "adminLogin") {
      const login = String(body.login || "").trim();
      const password = String(body.password || "");
      const { data: rows, error } = await supabase
        .from("taxichi_pro_dispatchers")
        .select("id,name,login,phone,email,password,password_hash,active,payment_mode,payment_provider,payment_settings")
        .eq("active", true)
        .limit(1000);
      if (error) throw error;
      const digits = phoneDigits(login);
      const account = (rows || []).find((row) => String(row.login || "").trim() === login || (digits && phoneDigits(String(row.phone || "")) === digits));
      const ok = account && await verifyPassword(password, account.password_hash, account.password);
      await logAttempt(supabase, req, "admin", login, !!ok, ok ? "" : "bad_credentials");
      if (!ok) return json({ error: "bad_credentials" }, 401);
      if (!account.password_hash) await supabase.from("taxichi_pro_dispatchers").update({ password_hash: await passwordHash(password), last_login_at: new Date().toISOString() }).eq("id", account.id);
      else await supabase.from("taxichi_pro_dispatchers").update({ last_login_at: new Date().toISOString() }).eq("id", account.id);
      const session = await createSession(supabase, "admin", String(account.id), req);
      return json({ ok: true, account: safeAdmin(account), sessionToken: session.token, expiresAt: session.expires_at });
    }

    if (action === "directorLogin") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const { data: rows, error } = await supabase
        .from("taxichi_pro_directors")
        .select("id,name,email,password,password_hash,active,can_manage_directors")
        .eq("active", true)
        .limit(200);
      if (error) throw error;
      const director = (rows || []).find((row) => String(row.email || "").trim().toLowerCase() === email);
      const ok = director && await verifyPassword(password, director.password_hash, director.password);
      await logAttempt(supabase, req, "director", email, !!ok, ok ? "" : "bad_credentials");
      if (!ok) return json({ error: "bad_credentials" }, 401);
      if (!director.password_hash) await supabase.from("taxichi_pro_directors").update({ password_hash: await passwordHash(password), last_login_at: new Date().toISOString() }).eq("id", director.id);
      else await supabase.from("taxichi_pro_directors").update({ last_login_at: new Date().toISOString() }).eq("id", director.id);
      const session = await createSession(supabase, "director", String(director.id), req);
      return json({ ok: true, director: safeDirector(director), sessionToken: session.token, expiresAt: session.expires_at });
    }

    if (action === "createDirectorView") {
      const session = await getSession(supabase, String(body.directorSessionToken || ""), "director");
      if (!session) return json({ error: "unauthorized" }, 401);
      const adminId = String(body.adminId || "");
      const { data: admin, error } = await supabase
        .from("taxichi_pro_dispatchers")
        .select("id,payment_settings,active")
        .eq("id", adminId)
        .maybeSingle();
      if (error) throw error;
      if (!admin || admin.active === false) return json({ error: "admin_not_found" }, 404);
      const token = crypto.randomUUID().replace(/[^a-zA-Z0-9-]/g, "");
      const payment_settings = settings(admin.payment_settings);
      payment_settings.directorView = { token, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), by: session.actor_id };
      await supabase.from("taxichi_pro_dispatchers").update({ payment_settings, updated_at: new Date().toISOString() }).eq("id", adminId);
      await supabase.from("taxichi_audit_logs").insert({ actor_type: "director", actor_id: session.actor_id, admin_id: adminId, action: "director_view_created", entity_table: "taxichi_pro_dispatchers", entity_id: adminId });
      return json({ ok: true, token, expiresAt: payment_settings.directorView.expiresAt });
    }

    if (action === "upsertDispatcher") {
      const session = await getSession(supabase, String(body.directorSessionToken || ""), "director");
      if (!session) return json({ error: "unauthorized" }, 401);
      const dispatcher = body.dispatcher || {};
      if (!dispatcher.id || !dispatcher.login) return json({ error: "bad_dispatcher" }, 400);
      const payload = {
        id: String(dispatcher.id),
        name: dispatcher.name || "Админ",
        email: dispatcher.email || "",
        phone: dispatcher.phone || "",
        login: dispatcher.login || "",
        password: dispatcher.password || "",
        password_hash: dispatcher.password ? await passwordHash(String(dispatcher.password)) : dispatcher.password_hash || null,
        active: dispatcher.active !== false,
        hidden_from_directors: dispatcher.hidden_from_directors === true,
        payment_mode: dispatcher.payment_mode || "admin_balance",
        payment_provider: dispatcher.payment_provider || "none",
        payment_settings: dispatcher.payment_settings || {},
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("taxichi_pro_dispatchers").upsert(payload, { onConflict: "id" });
      if (error) throw error;
      await supabase.from("taxichi_audit_logs").insert({ actor_type: "director", actor_id: session.actor_id, admin_id: payload.id, action: "dispatcher_upsert", entity_table: "taxichi_pro_dispatchers", entity_id: payload.id });
      return json({ ok: true });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: "server_error" }, 500);
  }
});
