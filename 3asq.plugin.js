const BASE = "https://3asq.online";

async function getDoc(path) {
  const res = await harbor.http(BASE + encodeURI(path), { responseType: "text" });
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
  const link = el.querySelector(".item-thumb a");
  if (!link) return null;
  const href = link.attr("href") || "";
  const img = el.querySelector(".item-thumb img");
  return {
    id: href.replace(/^https?:\/\/3asq\.online\/manga\//, "").replace(/^\/manga\//, "").replace(/\/$/, ""),
    title: (link.attr("title") || "").trim(),
    cover: abs(img?.attr("src") || img?.attr("data-src")),
  };
}

function parseChapterNumber(slug) {
  let normalized = slug.replace(/-(\d+)/g, ".$1");
  if (/^\d+(\.\d+)?$/.test(normalized)) {
    return normalized;
  }
  const match = normalized.match(/^(\d+)([a-z]+)$/i);
  if (match) {
    const numPart = match[1];
    const letterPart = match[2].toLowerCase();
    let fraction = 0;
    for (let i = 0; i < letterPart.length; i++) {
      fraction = fraction * 26 + (letterPart.charCodeAt(i) - 96);
    }
    return (parseFloat(numPart) + fraction / 100).toString();
  }
  const matchNum = normalized.match(/\d+(\.\d+)?/);
  return matchNum ? matchNum[0] : slug;
}

const plugin = {
  id: "3asq",
  name: "3asq",

  async popular(offset, tagId) {
    const page = Math.floor(offset / 20) + 1;
    let path = "";
    if (tagId) {
      path = "/manga-genre/" + tagId + "/page/" + page + "/?m_orderby=views";
    } else {
      path = "/manga/page/" + page + "/?m_orderby=views";
    }
    const doc = await getDoc(path);
    return doc.querySelectorAll(".page-item-detail.manga").map(cardToSummary).filter(Boolean);
  },

  async search(query, offset, tagId) {
    const page = Math.floor(offset / 20) + 1;
    const tag = tagId ? "&m_genre=" + tagId : "";
    const doc = await getDoc("/page/" + page + "/?s=" + encodeURIComponent(query) + "&post_type=wp-manga" + tag);
    return doc.querySelectorAll(".page-item-detail.manga").map(cardToSummary).filter(Boolean);
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + id);
    const title = doc.querySelector(".post-title h1")?.text() || id;
    const cover = abs(doc.querySelector(".summary_image img")?.attr("src") || doc.querySelector(".summary_image img")?.attr("data-src"));
    const description = doc.querySelector(".summary__content")?.text();
    const status = doc.querySelector(".post-status .summary-content")?.text();

    let author = "";
    const authorEl = doc.querySelector(".author-content a");
    if (authorEl) {
      author = authorEl.text().trim();
    } else {
      doc.querySelectorAll(".post-content_item").forEach(item => {
        const txt = item.text() || "";
        if (txt.includes("الكاتب") || txt.includes("المؤلف")) {
          const a = item.querySelector("a");
          if (a) author = a.text().trim();
        }
      });
    }

    return {
      id,
      title: title.trim(),
      cover,
      description: description ? description.trim() : "",
      status: status ? status.trim() : "",
      author,
    };
  },

  async chapters(id) {
    // Madara cached chapter list ajax endpoint
    const res = await harbor.http(BASE + "/manga/" + id + "/ajax/chapters/", { method: "POST", responseType: "text" });
    if (!res.ok) throw new Error("ajax chapters error " + res.status);
    const doc = harbor.parseHtml(res.body);

    const seen = new Set();
    const list = [];
    doc.querySelectorAll("li.wp-manga-chapter").forEach(li => {
      const a = li.querySelector("a");
      if (!a) return;
      const href = a.attr("href") || "";
      
      const matchSlug = href.match(/\/manga\/[^/]+\/([^/]+)\/?$/);
      const slug = matchSlug ? matchSlug[1] : "";
      if (!slug) return;
      
      const chapId = id + "/" + slug;
      if (seen.has(chapId)) return;
      seen.add(chapId);

      const num = parseChapterNumber(slug);

      const dateEl = li.querySelector(".chapter-release-date");
      const dateText = dateEl?.text()?.trim() || "";

      list.push({
        id: chapId,
        chapter: num,
        title: a.text().trim(),
        pages: 0,
        language: "ar",
        publishAt: dateText || undefined,
      });
    });

    list.sort((a, b) => parseFloat(b.chapter) - parseFloat(a.chapter));
    return list;
  },

  async pageUrls(chapterId) {
    const doc = await getDoc("/manga/" + chapterId);
    let imgs = doc.querySelectorAll(".reading-content img");
    if (imgs.length === 0) {
      imgs = doc.querySelectorAll(".page-break img");
    }
    if (imgs.length === 0) {
      imgs = doc.querySelectorAll("img");
    }
    return imgs.map((img) => {
      const src = (img.attr("src") || img.attr("data-src") || img.attr("data-lazy-src") || "").trim();
      if (src.includes("/wp-content/uploads/WP-manga/data/") || src.includes("/uploads/")) {
        return abs(src);
      }
      return null;
    }).filter(Boolean);
  },

  async tags() {
    const doc = await getDoc("/manga/");
    const seen = new Set();
    return doc.querySelectorAll("a[href*='/manga-genre/']").map(a => {
      const href = a.attr("href") || "";
      const id = href.match(/\/manga-genre\/([^/]+)/)?.[1] || "";
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return { id, name: a.text().trim(), group: "Genre" };
    }).filter(Boolean);
  }
};
