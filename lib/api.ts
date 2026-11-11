export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}

export async function apiSend<T>(
  url: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
  options?: { keepalive?: boolean },
): Promise<T> {
  const serialized = body ? JSON.stringify(body) : undefined;
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: serialized,
    keepalive: options?.keepalive && new TextEncoder().encode(serialized).byteLength <= 60 * 1024,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`${method} ${url} failed: ${res.status} ${msg}`);
  }
  return res.json();
}
