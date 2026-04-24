const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function git(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf-8" }).trim();
}

function fileExistsOnMain(filePath) {
  try {
    execSync(`git show origin/main:${filePath}`, {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

function readFrontMatter(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function isPublished(filePath) {
  const fm = readFrontMatter(filePath);
  if (/^published:\s*false$/m.test(fm)) return false;
  return true;
}

function discoverAllPages() {
  const pages = new Set(["/"]);
  const siteDir = path.join(ROOT, "_site");
  const useSiteScan = fs.existsSync(siteDir);

  if (useSiteScan) {
    const htmlFiles = execSync(
      `find ${siteDir} -name 'index.html' -not -path '*/admin/*' -not -path '*/preview/*'`,
      { encoding: "utf-8" }
    ).trim().split("\n").filter(Boolean);

    for (const f of htmlFiles) {
      const rel = f.replace(siteDir, "").replace(/index\.html$/, "");
      pages.add(rel);
    }
    return pages;
  }

  pages.add("/blog/");

  const postsDir = path.join(ROOT, "_posts");
  if (fs.existsSync(postsDir)) {
    for (const f of fs.readdirSync(postsDir)) {
      if (!f.endsWith(".md")) continue;
      const fullPath = path.join(postsDir, f);
      if (!isPublished(fullPath)) continue;
      const slug = f.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/\.md$/, "");
      pages.add(`/blog/${slug}/`);
    }
  }

  const projectsDir = path.join(ROOT, "_projects");
  if (fs.existsSync(projectsDir)) {
    for (const f of fs.readdirSync(projectsDir)) {
      if (!f.endsWith(".md")) continue;
      const slug = f.replace(/\.md$/, "");
      pages.add(`/projects/${slug}/`);
    }
  }

  const tagsDir = path.join(ROOT, "_tags");
  if (fs.existsSync(tagsDir)) {
    for (const f of fs.readdirSync(tagsDir)) {
      if (!f.endsWith(".md")) continue;
      const slug = f.replace(/\.md$/, "");
      pages.add(`/tags/${slug}/`);
    }
  }

  const pagesDir = path.join(ROOT, "pages");
  if (fs.existsSync(pagesDir)) {
    for (const f of fs.readdirSync(pagesDir)) {
      if (!f.endsWith(".md")) continue;
      const fullPath = path.join(pagesDir, f);
      if (!isPublished(fullPath)) continue;
      const fm = readFrontMatter(fullPath);
      const match = fm.match(/^permalink:\s*(.+)$/m);
      if (match) {
        pages.add(match[1].trim());
      } else {
        const slug = f.replace(/\.md$/, "");
        pages.add(`/pages/${slug}/`);
      }
    }
  }

  return pages;
}

function mapFileToUrls(filePath) {
  if (filePath.startsWith("_posts/") && filePath.endsWith(".md")) {
    const basename = path.basename(filePath, ".md");
    const slug = basename.replace(/^\d{4}-\d{2}-\d{2}-/, "");
    return [`/blog/${slug}/`];
  }

  if (filePath.startsWith("_projects/") && filePath.endsWith(".md")) {
    const slug = path.basename(filePath, ".md");
    return [`/projects/${slug}/`];
  }

  if (filePath.startsWith("_tags/") && filePath.endsWith(".md")) {
    const slug = path.basename(filePath, ".md");
    return [`/tags/${slug}/`];
  }

  if (filePath.startsWith("pages/") && filePath.endsWith(".md")) {
    const fullPath = path.join(ROOT, filePath);
    if (fs.existsSync(fullPath)) {
      const fm = readFrontMatter(fullPath);
      const match = fm.match(/^permalink:\s*(.+)$/m);
      if (match) return [match[1].trim()];
    }
    const slug = path.basename(filePath, ".md");
    return [`/pages/${slug}/`];
  }

  if (filePath === "index.html") return ["/"];
  if (filePath === "blog/index.html") return ["/blog/"];
  if (filePath === "projects/index.html") return ["/projects/"];

  if (
    filePath.startsWith("_layouts/") ||
    filePath.startsWith("_includes/") ||
    filePath.startsWith("assets/css/") ||
    filePath === "_config.yml"
  ) {
    return ["__ALL__"];
  }

  return [];
}

try {
  git("git fetch origin main --depth=1 2>/dev/null || true");
} catch {
  // may fail in some environments
}

let changedFiles;
try {
  changedFiles = git("git diff --name-only origin/main...HEAD")
    .split("\n")
    .filter(Boolean);
} catch {
  changedFiles = [];
}

const allPages = discoverAllPages();
const directlyChanged = new Set();
const newPages = new Set();
let globalChange = false;

for (const file of changedFiles) {
  const urls = mapFileToUrls(file);
  for (const url of urls) {
    if (url === "__ALL__") {
      globalChange = true;
    } else {
      directlyChanged.add(url);
      if (!fileExistsOnMain(file)) {
        newPages.add(url);
      }
    }
  }
}

const changed = [];
const newList = [];
const unchanged = [];

for (const page of allPages) {
  if (newPages.has(page)) {
    newList.push(page);
  } else if (globalChange || directlyChanged.has(page)) {
    changed.push(page);
  } else {
    unchanged.push(page);
  }
}

const result = { changed, new: newList, unchanged };
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
