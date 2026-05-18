const write = process.argv.includes('--write')
console.log(`${write ? '[write]' : '[dry-run]'} cleanup-media checks are placeholder-safe and do not delete local source media.`)
