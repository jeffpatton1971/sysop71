const dryRun = process.argv.includes('--dry-run')
console.log(`${dryRun ? '[dry-run] ' : ''}Content publish step uses Azure CLI in workflow to upload public/content to blob prefix.`)
