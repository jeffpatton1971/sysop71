import fs from 'node:fs/promises'
import path from 'node:path'
import { loadPost, readPostFiles } from './content-utils.mjs'

const root = process.cwd()
const outDir = path.join(root, 'public', 'content')
const configPath = path.join(root, 'content', 'site.config.json')

const config = JSON.parse(await fs.readFile(configPath, 'utf8'))
if (!config.key || !/^[a-z0-9-]+$/.test(config.key)) {
  throw new Error('content/site.config.json key is required and must match [a-z0-9-]+')
}

await fs.mkdir(outDir, { recursive: true })

const files = await readPostFiles()
const all = []
for (const file of files) {
  const { normalized, parsed } = await loadPost(file)
  all.push({ ...normalized, body: parsed.content.trim() })
}

all.sort((a, b) => String(b.date).localeCompare(String(a.date)))

const posts = all.filter((p) => p.content_type === 'post')
const stories = all.filter((p) => p.content_type === 'story')
const galleries = all.filter((p) => p.content_type === 'gallery')
const images = all.flatMap((item) => item.images || [])

const site = {
  key: config.key,
  title: config.title,
  url: config.url,
  nav: config.nav || []
}

const home = {
  site,
  latest: {
    posts: posts.slice(0, 10),
    stories: stories.slice(0, 10),
    galleries: galleries.slice(0, 10)
  }
}

const search = {
  site,
  items: all.map((item) => ({
    post_id: item.post_id,
    slug: item.slug,
    title: item.title,
    summary: item.summary,
    content_type: item.content_type,
    date: item.date
  }))
}

const writeJson = (name, data) => fs.writeFile(path.join(outDir, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`)

await Promise.all([
  writeJson('site', site),
  writeJson('home', home),
  writeJson('posts', { site, items: posts }),
  writeJson('stories', { site, items: stories }),
  writeJson('galleries', { site, items: galleries }),
  writeJson('images', { site, items: images }),
  writeJson('search', search)
])

console.log(`Generated content JSON for site '${config.key}' with ${all.length} items.`)
