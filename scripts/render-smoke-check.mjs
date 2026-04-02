const backendHealthUrl = process.env.BACKEND_HEALTH_URL ?? "http://127.0.0.1:3001/health";
const frontendUrl = process.env.FRONTEND_URL;

async function fetchUrl(url, label) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`${label} check failed: ${response.status} ${response.statusText}`);
  }

  return response;
}

async function checkBackendHealth(url) {
  const response = await fetchUrl(url, "Backend health");
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`Backend health check failed: expected JSON response, got '${contentType || "unknown"}'.`);
  }

  const payload = await response.json();

  if (!payload || payload.ok !== true) {
    throw new Error("Backend health check failed: expected payload { ok: true }.");
  }

  console.log(`Backend health check passed: ${response.status}`);
}

async function checkFrontend(url) {
  const response = await fetchUrl(url, "Frontend");
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().includes("text/html")) {
    throw new Error(`Frontend check failed: expected HTML response, got '${contentType || "unknown"}'.`);
  }

  const html = await response.text();
  if (!html.toLowerCase().includes("<!doctype html")) {
    throw new Error("Frontend check failed: response does not appear to be an HTML document.");
  }

  console.log(`Frontend check passed: ${response.status}`);
}

async function main() {
  console.log(`Running Render smoke checks against backend: ${backendHealthUrl}`);
  await checkBackendHealth(backendHealthUrl);

  if (frontendUrl) {
    console.log(`Running frontend reachability check: ${frontendUrl}`);
    await checkFrontend(frontendUrl);
  } else {
    console.log("Skipping frontend check (FRONTEND_URL not set).");
  }

  console.log("Render smoke checks passed.");
}

main().catch((error) => {
  console.error("Render smoke checks failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
