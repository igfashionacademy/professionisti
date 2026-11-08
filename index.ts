import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-admin-pass, authorization, apikey, content-type",
};
const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// constant-time string compare
const eq = (a: string, b: string) => {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
};

// best-effort brute-force limit (resets when the function instance restarts)
const fails = new Map<string, { n: number; t: number }>();
// best-effort public comment limit: timestamps of recent comments per IP
const posts = new Map<string, number[]>();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "Method not allowed" }, 405);

  const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "?").split(",")[0].trim();
  const fd = await req.formData();
  const action = fd.get("action");
  const s = (k: string, max: number) => String(fd.get(k) ?? "").slice(0, max);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const id = s("id", 40);

  // public: anyone can leave a comment, optionally with a 1-5 star rating
  if (action === "comment") {
    const recent = (posts.get(ip) ?? []).filter((t) => Date.now() - t < 10 * 60_000);
    if (recent.length >= 5) return j({ error: "Hai inviato troppi commenti, riprova più tardi" }, 429);
    if (s("website", 10)) return j({ ok: true }); // honeypot: only bots fill the hidden field
    const person_id = s("person_id", 40);
    const author = s("author", 60).trim();
    const body = s("body", 1000).trim();
    const r = Number(s("rating", 1));
    const rating = r >= 1 && r <= 5 ? r : null;
    if (!/^[0-9a-f-]{36}$/i.test(person_id)) return j({ error: "Professionista non valido" }, 400);
    if (!author || !body) return j({ error: "Nome e commento sono obbligatori" }, 400);
    const { data, error } = await sb.from("reviews").insert({ person_id, author, rating, body }).select().single();
    if (error) return j({ error: "Invio non riuscito" }, 500);
    posts.set(ip, [...recent, Date.now()]);
    return j({ ok: true, row: data });
  }

  const f = fails.get(ip);
  if (f && f.n >= 5 && Date.now() - f.t < 15 * 60_000) return j({ error: "Troppi tentativi, riprova più tardi" }, 429);

  const secret = Deno.env.get("ADMIN_PASSPHRASE");
  if (!secret || !eq(req.headers.get("x-admin-pass") ?? "", secret)) {
    fails.set(ip, { n: (f?.n ?? 0) + 1, t: Date.now() });
    return j({ admin: false, error: "Accesso negato" }, 401);
  }
  fails.delete(ip);

  if (action === "check") return j({ admin: true });

  if (action === "resolve" || action === "delete_comment") {
    if (!id) return j({ error: "ID mancante" }, 400);
    const q = action === "resolve"
      ? sb.from("reviews").update({ resolved: s("resolved", 1) === "1" }).eq("id", id)
      : sb.from("reviews").delete().eq("id", id);
    const { error } = await q;
    if (error) return j({ error: "Operazione non riuscita" }, 500);
    return j({ ok: true });
  }

  if (action === "delete") {
    if (!id) return j({ error: "ID mancante" }, 400);
    const { error } = await sb.from("people").delete().eq("id", id);
    if (error) return j({ error: "Eliminazione non riuscita" }, 500);
    return j({ ok: true });
  }
  if (action !== "save") return j({ error: "Unknown action" }, 400);

  const location_id = s("location_id", 120);
  const name = s("name", 100).trim();
  if (!location_id.startsWith("province:")) return j({ error: "I professionisti si aggiungono solo nelle province" }, 400);
  if (!name) return j({ error: "Il nome è obbligatorio" }, 400);

  const row: Record<string, unknown> = {
    location_id,
    location_name: s("location_name", 120),
    name,
    description: s("description", 2000),
    phone: s("phone", 200), // address
    services: s("services", 1000), // services, one per line
    socials: s("socials", 1000), // contacts, one per line
    updated_at: new Date().toISOString(),
  };
  const photo = fd.get("photo");
  if (photo instanceof File && photo.size > 0) {
    if (!photo.type.startsWith("image/") || photo.size > 5_000_000) return j({ error: "La foto deve essere un'immagine sotto i 5 MB" }, 400);
    const ext = (photo.name.split(".").pop() ?? "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
    const path = `${crypto.randomUUID()}.${ext}`;
    const up = await sb.storage.from("photos").upload(path, photo, { contentType: photo.type });
    if (up.error) return j({ error: "Caricamento della foto non riuscito" }, 500);
    row.photo_url = sb.storage.from("photos").getPublicUrl(path).data.publicUrl;
  }

  // with an id we update that professional, without one we add a new one
  const q = id ? sb.from("people").update(row).eq("id", id) : sb.from("people").insert(row);
  const { data, error } = await q.select().single();
  if (error) return j({ error: "Salvataggio non riuscito" }, 500);
  return j({ ok: true, row: data });
});
