const BASE = "https://azorafly.com";

async function getDoc(path) {
  const res = await harbor.http(BASE + path, { responseType: "text" });
  if (!res.ok) throw new Error("http " + res.status + " for " + path);
  return harbor.parseHtml(res.body);
}

function abs(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function cardToSummary(el) {
  const link = el.querySelector("a[href*='/series/']");
  if (!link) return null;
  const href = link.attr("href") || "";
  const img = el.querySelector("img");
  return {
    id: href.replace(/^\/series\//, "").replace(/\/$/, ""),
    title: (link.attr("title") || "").trim(),
    cover: abs(img?.attr("src")),
  };
}

const plugin = {
  id: "azora",
  name: "Azora",

  async popular(offset, tagId) {
    const page = Math.floor(offset / 39) + 1;
    const query = tagId ? "&genres=" + tagId : "";
    const doc = await getDoc("/series?sortBy=latest_chapters&sortDirection=desc&page=" + page + query);
    return doc.querySelectorAll("div.bg-card").map(cardToSummary).filter(Boolean);
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / 39) + 1;
    const tag = tagId ? "&genres=" + tagId : "";
    const doc = await getDoc("/series?searchTerm=" + encodeURIComponent(query) + "&page=" + page + tag);
    return doc.querySelectorAll("div.bg-card").map(cardToSummary).filter(Boolean);
  },

  async detail(id) {
    const doc = await getDoc("/series/" + id);
    const title = doc.querySelector("h1[itemprop='name']")?.text() || id;
    const cover = abs(doc.querySelector("img[alt*='Cover of']")?.attr("src"));
    const description = doc.querySelector("div.rounded-lg p")?.text();

    let status = undefined;
    const divs = doc.querySelectorAll("div.flex.sm\\:justify-between");
    for (const div of divs) {
      const text = div.text() || "";
      if (text.includes("الحالة")) {
        status = div.querySelector("p")?.text() || "";
        break;
      }
    }

    return {
      id,
      title: title.trim(),
      cover,
      description: description ? description.trim() : "",
      status: status ? status.trim() : "",
      author: "",
    };
  },

  async chapters(id) {
    const doc = await getDoc("/series/" + id);
    const seen = new Set();
    const list = [];
    doc.querySelectorAll("a[href*='/chapter-']").forEach((a) => {
      const href = a.attr("href") || "";
      const chapId = href.replace(/^\/series\//, "").replace(/^\//, "");
      if (!chapId || seen.has(chapId)) return;
      seen.add(chapId);

      const numMatch = href.match(/chapter-(\d+)/);
      const num = numMatch ? numMatch[1] : null;
      const dateEl = a.querySelector("span[aria-label]");
      list.push({
        id: chapId,
        chapter: num,
        title: null,
        pages: 0,
        language: "ar",
        publishAt: dateEl?.attr("aria-label") || undefined,
      });
    });
    return list;
  },

  async pageUrls(chapterId) {
    const doc = await getDoc("/series/" + chapterId);
    return doc.querySelectorAll("figure.image-container img").map((img) => {
      return abs(img.attr("src"));
    }).filter(Boolean);
  },

  async tags() {
    const doc = await getDoc("/series");
    return doc.querySelectorAll("a[href*='genres=']").map(a => {
      const href = a.attr("href") || "";
      const id = href.match(/genres=([^&]+)/)?.[1] || "";
      return id ? { id, name: a.text().trim(), group: "Genre" } : null;
    }).filter(Boolean);
  }
};
