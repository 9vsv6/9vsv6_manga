const BASE = "https://olympustaff.com";

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
  const href = el.attr("href") || el.querySelector("a")?.attr("href") || "";
  if (!href) return null;
  const img = el.querySelector("img");
  const title = (el.querySelector("h4")?.text() || el.querySelector(".tt")?.text() || el.attr("title") || el.querySelector("a")?.attr("title") || "").trim();
  return {
    id: href.replace(/^https?:\/\/olympustaff\.com\/series\//, "").replace(/^\/series\//, "").replace(/\/$/, ""),
    title,
    cover: abs(img?.attr("src")),
  };
}

const plugin = {
  id: "teamx",
  name: "Team X",

  async popular(offset, tagId) {
    const page = Math.floor(offset / 10) + 1;
    let query = "";
    if (tagId) {
      const [type, val] = tagId.split(":");
      query = `&${type}=${encodeURIComponent(val)}`;
    }
    const doc = await getDoc("/series?page=" + page + query);
    return doc.querySelectorAll("div.bs").map(cardToSummary).filter(Boolean);
  },

  async search(query, offset, tagId) {
    if (offset > 0) return []; // AJAX search does not support pagination
    const doc = await getDoc("/ajax/search?keyword=" + encodeURIComponent(query));
    return doc.querySelectorAll("a.group").map(cardToSummary).filter(Boolean);
  },

  async detail(id) {
    const doc = await getDoc("/series/" + id);
    const title = doc.querySelector(".author-info-title h1")?.text() || id;
    const cover = abs(doc.querySelector(".text-right img")?.attr("src"));
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
      id,
      title: title.trim(),
      cover,
      description: description ? description.trim() : "",
      status: status ? status.trim() : "",
      author: author ? author.trim() : "",
    };
  },

  async chapters(id) {
    const seriesSlug = id.replace(/^\/series\//, "").replace(/^\//, "").replace(/\/$/, "");
    const list = [];
    const seen = new Set();
    let page = 1;
    while (true) {
      const doc = await getDoc("/series/" + seriesSlug + "?page=" + page);
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
        const chapId = "series/" + seriesSlug + "/" + num;
        if (seen.has(chapId)) return;
        seen.add(chapId);
        
        const titleEl = card.querySelector(".chapter-title");
        const dateEl = card.querySelector(".chapter-date span");
        list.push({
          id: chapId,
          chapter: num,
          title: titleEl?.text()?.trim() || null,
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

    // Sort descending strictly by chapter number to preserve Harbor groups
    list.sort((a, b) => parseFloat(b.chapter) - parseFloat(a.chapter));
    return list;
  },

  async pageUrls(chapterId) {
    const doc = await getDoc("/" + chapterId);
    let imgs = doc.querySelectorAll(".read-container img");
    if (imgs.length === 0) {
      imgs = doc.querySelectorAll(".entry-content img");
    }
    if (imgs.length === 0) {
      imgs = doc.querySelectorAll("img");
    }
    return imgs.map((img) => {
      const src = img.attr("src") || img.attr("data-src") || img.attr("data-lazy-src") || "";
      if (src.includes("/uploads/manga_") || src.includes("/chapter/")) {
        return abs(src);
      }
      return null;
    }).filter(Boolean);
  },

  async tags() {
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
  }
};
