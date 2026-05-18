# React/API Site Migration Notes (sysop71)

This repository migrated from Jekyll GitHub Pages to a React + shared API site architecture.

## Site settings

- Site id: `sysop71`
- Site URL: `https://sysop71.com`
- Shared API base URL: `https://ptech-sites-api.azurewebsites.net`
- Storage account: `prdwebappstorage`
- Storage container: `sysop71`
- Storage prefix: `current`

## Required GitHub Production environment values

- Secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`
- Variables:
  - `AZURE_WEBAPP_NAME=sysop71`
  - `AZURE_WEBAPP_RESOURCE_GROUP=WebApplications`
  - `AZURE_WEBAPP_URL=https://sysop71.azurewebsites.net`
  - `AZURE_API_BASE_URL=https://ptech-sites-api.azurewebsites.net`
  - `VITE_API_BASE_URL=https://ptech-sites-api.azurewebsites.net`
  - `VITE_API_SITE_ID=sysop71`
  - `CONTENT_SITE_KEY=sysop71`
  - `CONTENT_SITE_URL=https://sysop71.com`
  - `CONTENT_STORAGE_ACCOUNT=prdwebappstorage`
  - `CONTENT_STORAGE_CONTAINER=sysop71`
  - `CONTENT_STORAGE_PREFIX=current`
  - `REQUIRE_API_VERIFICATION=false`
