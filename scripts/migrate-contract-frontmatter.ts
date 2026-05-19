import fs from 'node:fs/promises';
import path from 'node:path';

const postsRoot = path.join(process.cwd(), '_posts');
const write = process.argv.includes('--write');

type Stats = {
  files: number;
  changed: number;
  contentTypeArticleToPost: number;
  relatedArticleToPost: number;
  companionArticleRelToPost: number;
};

const stats: Stats = {
  files: 0,
  changed: 0,
  contentTypeArticleToPost: 0,
  relatedArticleToPost: 0,
  companionArticleRelToPost: 0,
};

async function main() {
  const files = (await fs.readdir(postsRoot)).filter((file) => file.endsWith('.md')).sort();

  for (const file of files) {
    await migrateFile(file);
  }

  console.log(`${write ? 'Migrated' : 'Would migrate'} ${stats.changed} of ${stats.files} content files.`);
  console.log(`content_type article -> post: ${stats.contentTypeArticleToPost}`);
  console.log(`related.type article -> post: ${stats.relatedArticleToPost}`);
  console.log(`related.rel companion-article -> companion-post: ${stats.companionArticleRelToPost}`);
}

async function migrateFile(file: string) {
  stats.files += 1;

  const fullPath = path.join(postsRoot, file);
  const raw = await fs.readFile(fullPath, 'utf8');
  let next = raw;

  next = next.replace(
    /^(\s*content_type:\s*)(["']?)article\2\s*$/gm,
    (_match, prefix: string) => {
      stats.contentTypeArticleToPost += 1;
      return `${prefix}post`;
    },
  );

  next = next.replace(
    /^(\s*-?\s*type:\s*)(["']?)article\2\s*$/gm,
    (_match, prefix: string) => {
      stats.relatedArticleToPost += 1;
      return `${prefix}post`;
    },
  );

  next = next.replace(
    /^(\s*rel:\s*)(["']?)companion-article\2\s*$/gm,
    (_match, prefix: string) => {
      stats.companionArticleRelToPost += 1;
      return `${prefix}companion-post`;
    },
  );

  if (next === raw) {
    return;
  }

  stats.changed += 1;

  if (write) {
    await fs.writeFile(fullPath, next, 'utf8');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
