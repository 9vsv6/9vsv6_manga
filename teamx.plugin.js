// Harbor manga provider plugin for Team X (olympustaff.com)

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
  const h3Title = el.querySelector("h3")?.text() || el.querySelector("h4")?.text() || el.querySelector(".tt")?.text();
  const title = (link.attr("title") || h3Title || link.text() || "").trim();
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
    let url = "/series?page=" + page;

    if (tagId) {
      if (tagId === "latest" || tagId === "sort:latest") {
        url = "/?page=" + page;
      } else if (tagId.includes(":")) {
        const parts = tagId.split(":");
        const type = parts[0];
        const val = parts.slice(1).join(":");
        url = `/series?page=${page}&${type}=${encodeURIComponent(val)}`;
      }
    }

    const doc = await getDoc(url);
    let cards = doc.querySelectorAll("div.uta, div.box, div.bsx, div.bs");
    if (cards.length === 0) {
      cards = doc.querySelectorAll("a[href*='/series/']");
    }

    const seen = new Set();
    const result = [];
    for (const card of cards) {
      const summary = cardToSummary(card);
      if (summary && !seen.has(summary.id)) {
        seen.add(summary.id);
        result.push(summary);
      }
    }
    return result;
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
      const title = doc.querySelector(".author-info-title h1")?.text() || doc.querySelector("h1")?.text() || slug;
      const coverUrl = doc.querySelector(".text-right img")?.attr("src") || doc.querySelector("img.shadow-sm")?.attr("src") || doc.querySelector("img[src*='/manga/']")?.attr("src") || doc.querySelector("img[src*='/images/']")?.attr("src");
      const cover = abs(coverUrl);
      const description = doc.querySelector(".review-content p")?.text() || doc.querySelector(".review-content")?.text();

      let status = undefined;
      let author = undefined;
      const listInfos = doc.querySelectorAll(".full-list-info");
      for (const info of listInfos) {
        const text = info.text() || "";
        if (text.includes("الحالة:")) {
          const a = info.querySelector("a");
          status = a ? a.text().trim() : text.replace("الحالة:", "").trim();
        }
        if (text.includes("الرسام:") || text.includes("الكاتب:") || text.includes("المؤلف:")) {
          const a = info.querySelector("a");
          author = a ? a.text().trim() : text.split(":")[1]?.trim();
        }
      }
      if (!status) {
        status = doc.querySelector('a[href*="status="]')?.text();
      }

      return {
        id: id,
        title: title ? title.trim() : slug,
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
        let href = link.attr("href") || "";
        if (href === "#" || href.startsWith("#") || href.includes("javascript:")) {
          href = "";
        }
        
        let num = card.attr("data-number") || null;
        if (!num) {
          const numText = card.querySelector(".chapter-number")?.text() || "";
          const numMatch = numText.match(/\d+(\.\d+)?/);
          num = numMatch ? numMatch[0] : null;
        }
        if (!num && href) {
          const hrefMatch = href.match(/\/(\d+(\.\d+)?)\/?$/);
          num = hrefMatch ? hrefMatch[1] : null;
        }

        const cleanPath = href ? href.replace(/^https?:\/\/[^\/]+/, "").replace(/^\/+|\/+$/g, "") : ("series/" + seriesSlug + "/" + (num || "0"));
        const chapId = "teamx-" + cleanPath;
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

      const statuses = doc.querySelectorAll("#select_state option")
        .map(opt => {
          const val = opt.attr("value");
          return val ? { id: "status:" + val, name: opt.text().trim(), group: "Status" } : null;
        }).filter(Boolean);

      return [...genres, ...types, ...statuses];
    } catch (e) {
      return [];
    }
  }
};

harbor.register(plugin);
