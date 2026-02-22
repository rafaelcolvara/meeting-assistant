let accessToken: string | null = null;

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export async function refreshAccessToken() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
  const response = await fetch(`${apiUrl}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
    },
  });

  if (!response.ok) {
    setAccessToken(null);
    return null;
  }

  const payload = (await response.json()) as { accessToken?: string };
  const token = payload.accessToken ?? null;
  setAccessToken(token);
  return token;
}
