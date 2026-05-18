import fs from 'node:fs/promises'
import matter from 'gray-matter'
import { loadPost, readPostFiles } from './content-utils.mjs'

const files = await readPostFiles()

for (const file of files) {
  const { fullPath, parsed, normalized } = await loadPost(file)
  const output = matter.stringify(parsed.content.trimStart() + '\n', normalized)
  await fs.writeFile(fullPath, output)
}

console.log(`Normalized frontmatter for ${files.length} posts.`)
