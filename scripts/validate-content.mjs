import fs from 'node:fs/promises'
import path from 'node:path'
import { loadPost, readPostFiles, validateNormalizedFrontmatter } from './content-utils.mjs'

const root = process.cwd()
const siteConfigPath = path.join(root, 'content', 'site.config.json')
const siteConfigRaw = await fs.readFile(siteConfigPath, 'utf8')
const siteConfig = JSON.parse(siteConfigRaw)

if (!siteConfig.key || !/^[a-z0-9-]+$/.test(siteConfig.key)) {
  throw new Error('content/site.config.json key is required and must match [a-z0-9-]+')
}

const files = await readPostFiles()
const failures = []

for (const file of files) {
  const { normalized, parsed } = await loadPost(file)
  const errors = validateNormalizedFrontmatter(normalized)
  const forbiddenOriginal = ['layout', 'permalink', 'published', 'comments', 'share', 'tags']
  for (const key of forbiddenOriginal) {
    if (Object.prototype.hasOwnProperty.call(parsed.data, key)) {
      errors.push(`frontmatter contains forbidden jekyll key '${key}'`)
    }
  }

  if (errors.length) {
    failures.push(`${file}: ${errors.join('; ')}`)
  }
}

if (failures.length) {
  console.error('Content validation failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Content validation passed for ${files.length} posts.`)
