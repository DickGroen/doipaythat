// worker/utils/response.js

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS
    }
  });
}

export function corsResponse() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
}

// Alias used by webhook.js
export const json = jsonResponse;
