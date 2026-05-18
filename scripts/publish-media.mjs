import fs from 'node:fs/promises'
import path from 'node:path'

const dryRun = process.argv.includes('--dry-run')
const root = process.cwd()
const assetsDir = path.join(root, 'assets')

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walk(full))
    } else {
      files.push(full)
    }
  }
  return files
}

const files = await walk(assetsDir)
console.log(`${dryRun ? '[dry-run] ' : ''}Media files discovered under assets/: ${files.length}`)
