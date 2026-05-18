const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://ptech-sites-api.azurewebsites.net'
const SITE_ID = import.meta.env.VITE_API_SITE_ID

export function getSiteId() {
  if (!SITE_ID) {
    throw new Error('VITE_API_SITE_ID is required and must not fall back to a default site id.')
  }
  return SITE_ID
}

export async function fetchApi(path, query = '') {
  const siteId = getSiteId()
  const url = `${API_BASE}/api/${siteId}/${path}${query}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`API request failed (${response.status}): ${url}`)
  }
  return response.json()
}
