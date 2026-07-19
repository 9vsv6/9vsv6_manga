const BASE = "https://olympustaff.com";

async function getDoc(path) {
  const res = await harbor.http(BASE + encodeURI(path), { responseType: "text" });
  if (!res.ok) throw new Error("http " + res.status + " for " + path);
  return harbor.parseHtml(res.body);
}

function abs(url) {
  if (!url || url.startsWith("data:")) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE + url;
  return BASE + "/" + url;
}

function cleanSlug(id) {
  if (!id) return "";
  let s = String(id).trim();
  s = s.replace(/^teamx-/, "");
  s = s.replace(/^https?:\/\/[^\/]+/, "");
  s = s.replace(/^(series\/|\/series\/)/, "");
  s = s.replace(/^\/+|\/+$/g, "");
  return s;
}

function cleanChapterPath(chapterId) {
  if (!chapterId) return "";
  let s = String(chapterId).trim();
  s = s.replace(/^teamx-/, "");
  s = s.replace(/^https?:\/\/[^\/]+/, "");
  s = s.replace(/^\/+|\/+$/g, "");
  if (!s.startsWith("series/")) {
    s = "series/" + s;
  }
  return s;
}

function cardToSummary(el) {
  const link = el.name === "a" ? el : (el.querySelector("a[href*='/series/']") || el.querySelector("a"));
  if (!link) return null;
  const href = link.attr("href") || "";
  if (!href || href === "#" || href.includes("javascript:")) return null;

  const img = el.querySelector("img") || link.querySelector("img");
  const title = (link.attr("title") || el.querySelector(".tt")?.text() || el.querySelector("h4")?.text() || link.text() || "").trim();
  if (!title) return null;

  const coverUrl = img?.attr("src") || img?.attr("data-src") || img?.attr("data-lazy-src") || "";
  const cover = abs(coverUrl);

  const slug = cleanSlug(href);
  if (!slug || slug === "series") return null;

  return {
    id: "teamx-" + slug,
    title,
    cover: cover && /^https?:\/\//i.test(cover) ? cover : undefined,
  };
}

const plugin = {
  id: "teamx",
  name: "Team X",

  async popular(offset, tagId) {
    const page = Math.floor(offset / 48) + 1;
    let query = "";
    if (tagId) {
      const [type, val] = tagId.split(":");
      query = `&${type}=${encodeURIComponent(val)}`;
    }
    const doc = await getDoc("/series?page=" + page + query);
    let cards = doc.querySelectorAll("div.bsx, div.bs");
    if (cards.length === 0) {
      cards = doc.querySelectorAll("a[href*='/series/']");
    }
    return cards.map(cardToSummary).filter(Boolean);
  },

  async search(query, offset, tagId) {
    if (offset > 0) return [];
    const doc = await getDoc("/ajax/search?keyword=" + encodeURIComponent(query));
    return doc.querySelectorAll("a.group, a[href*='/series/']").map(cardToSummary).filter(Boolean);
  },

  async detail(id) {
    const slug = cleanSlug(id);
    if (!slug) return null;
    try {
      const doc = await getDoc("/series/" + slug);
      const title = doc.querySelector(".author-info-title h1")?.text() || slug;
      const coverUrl = doc.querySelector(".text-right img")?.attr("src") || doc.querySelector("img[src*='/manga/']")?.attr("src");
      const cover = abs(coverUrl);
      const description = doc.querySelector(".review-content p")?.text();
      const status = doc.querySelector('a[href*="status="]')?.text();

      let author = undefined;
      const listInfos = doc.querySelectorAll(".full-list-info");
      for (const info of listInfos) {
        const text = info.text() || "";
        if (text.includes("الرسام:") || text.includes("الكاتب:") || text.includes("المؤلف:")) {
          author = info.querySelector("a")?.text() || text.split(":")[1]?.trim();
          break;
        }
      }

      return {
        id: "teamx-" + slug,
        title: title.trim(),
        cover: cover && /^https?:\/\//i.test(cover) ? cover : undefined,
        description: description ? description.trim() : undefined,
        status: status ? status.trim() : undefined,
        author: author ? author.trim() : undefined,
      };
    } catch (e) {
      return null;
    }
  },

  async chapters(id) {
    const seriesSlug = cleanSlug(id);
    if (!seriesSlug) return [];
    const list = [];
    const seen = new Set();
    let page = 1;
    while (true) {
      let doc;
      try {
        doc = await getDoc("/series/" + seriesSlug + "?page=" + page);
      } catch (e) {
        break;
      }
      const cards = doc.querySelectorAll(".chapter-card");
      if (cards.length === 0) break;
      
      let newAdded = 0;
      cards.forEach((card) => {
        const link = card.querySelector("a.chapter-link");
        if (!link) return;
        let num = card.attr("data-number") || null;
        if (!num) {
          const numText = card.querySelector(".chapter-number")?.text() || "";
          const numMatch = numText.match(/\d+(\.\d+)?/);
          num = numMatch ? numMatch[0] : null;
        }
        const chapId = "teamx-series/" + seriesSlug + "/" + (num || "0");
        if (seen.has(chapId)) return;
        seen.add(chapId);
        
        const titleEl = card.querySelector(".chapter-title");
        const dateEl = card.querySelector(".chapter-date span");
        list.push({
          id: chapId,
          chapter: num ? String(num) : null,
          title: titleEl?.text()?.trim() || undefined,
          pages: 0,
          language: "ar",
          publishAt: dateEl?.text()?.trim() || undefined,
        });
        newAdded++;
      });
      
      if (newAdded === 0) {
        break;
      }
      page++;
    }

    list.sort((a, b) => (parseFloat(b.chapter) || 0) - (parseFloat(a.chapter) || 0));
    return list;
  },

  async pageUrls(chapterId) {
    const path = cleanChapterPath(chapterId);
    if (!path) return [];
    let doc;
    try {
      doc = await getDoc("/" + path);
    } catch (e) {
      return [];
    }
    let imgs = doc.querySelectorAll(".read-container img");
    if (imgs.length === 0) {
      imgs = doc.querySelectorAll(".entry-content img");
    }
    if (imgs.length === 0) {
      imgs = doc.querySelectorAll("img");
    }
    return imgs.map((img) => {
      const src = img.attr("src") || img.attr("data-src") || img.attr("data-lazy-src") || "";
      if (!src.includes("logo") && !src.includes("favicon") && !src.includes("TeamX.png") && (src.includes("/uploads/") || src.includes("/images/manga/") || src.includes(".webp") || src.includes(".jpg") || src.includes(".png"))) {
        const full = abs(src);
        if (full && /^https?:\/\//i.test(full)) return full;
      }
      return null;
    }).filter(Boolean);
  },

  async tags() {
    try {
      const doc = await getDoc("/series");
      const genres = doc.querySelectorAll("#select_genre option")
        .map(opt => {
          const val = opt.attr("value");
          return val ? { id: "genre:" + val, name: opt.text().trim(), group: "Genre" } : null;
        }).filter(Boolean);
      const types = doc.querySelectorAll("#select_type option")
        .map(opt => {
          const val = opt.attr("value");
          return val ? { id: "type:" + val, name: opt.text().trim(), group: "Type" } : null;
        }).filter(Boolean);
      return [...genres, ...types];
    } catch (e) {
      return [];
    }
  }
};

harbor.register(plugin);
