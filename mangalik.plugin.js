const BASE = "https://mangalik.net";

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
  const link = el.querySelector("a[href*='/manga/']");
  if (!link) return null;
  const href = link.attr("href") || "";
  const img = el.querySelector("img");
  return {
    id: href.replace(/^https?:\/\/mangalik\.net\/manga\//, "").replace(/^\/manga\//, "").replace(/\/$/, ""),
    title: (link.attr("title") || link.text() || "").trim(),
    cover: abs(img?.attr("src") || img?.attr("data-src") || img?.attr("data-lazy-src")),
  };
}

const plugin = {
  id: "mangalik",
  name: "Mangalik",

  async popular(offset, tagId) {
    const page = Math.floor(offset / 20) + 1;
    let path = "/manga/page/" + page + "/?m_orderby=views";
    if (page === 1) {
      // Fetch homepage directly since it bypasses WAF and contains popular/latest
      path = "/";
    }
    const doc = await getDoc(path);
    return doc.querySelectorAll("div.page-item-detail").map(cardToSummary).filter(Boolean);
  },

  async search(query, offset, tagId) {
    // We use the AJAX search endpoint since it bypasses Cloudflare completely!
    if (offset > 0) return [];
    const res = await harbor.http(BASE + "/wp-admin/admin-ajax.php", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "action=wp-manga-search-manga&title=" + encodeURIComponent(query)
    });
    if (!res.ok) throw new Error("search failed: " + res.status);
    const result = JSON.parse(res.body);
    if (!result.success || !result.data) return [];
    return result.data.map(item => {
      const href = item.url || "";
      const id = href.replace(/^https?:\/\/mangalik\.net\/manga\//, "").replace(/^\/manga\//, "").replace(/\/$/, "");
      return {
        id,
        title: item.title,
        cover: undefined,
      };
    });
  },

  async detail(id) {
    const doc = await getDoc("/manga/" + id + "/");
    const title = doc.querySelector(".post-title h1")?.text() || id;
    const cover = abs(doc.querySelector(".summary_image img")?.attr("src") || doc.querySelector(".summary_image img")?.attr("data-src"));
    const description = doc.querySelector(".description-summary")?.text() || doc.querySelector(".manga-excerpt")?.text();

    let status = undefined;
    const items = doc.querySelectorAll(".post-content_item");
    for (const item of items) {
      const text = item.text() || "";
      if (text.includes("Status") || text.includes("الحالة")) {
        status = item.querySelector(".summary-content")?.text() || text.replace(/الحالة|Status/g, "").replace(/:/g, "").trim();
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
    let doc;
    try {
      doc = await getDoc("/manga/" + id + "/");
    } catch (e) {
      throw e;
    }

    // Try to parse from the page HTML first (if solved)
    let chaptersList = doc.querySelectorAll("li.wp-manga-chapter");
    
    // If empty, try to get manga ID from the page body and fetch via AJAX
    if (chaptersList.length === 0) {
      const pageHtml = doc.toString() || "";
      const mangaIdMatch = pageHtml.match(/manga-id-(\d+)/) || pageHtml.match(/post-(\d+)/) || pageHtml.match(/data-post-id=["'](\d+)["']/);
      if (mangaIdMatch) {
        const mangaId = mangaIdMatch[1];
        const res = await harbor.http(BASE + "/wp-admin/admin-ajax.php", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `action=manga_get_chapters&manga=${mangaId}`
        });
        if (res.ok && res.body) {
          const ajaxDoc = harbor.parseHtml(res.body);
          chaptersList = ajaxDoc.querySelectorAll("li.wp-manga-chapter");
        }
      }
    }

    return chaptersList.map((li) => {
      const link = li.querySelector("a");
      if (!link) return null;
      const href = link.attr("href") || "";
      const dateEl = li.querySelector(".chapter-release-date");
      return {
        id: href.replace(/^https?:\/\/mangalik\.net\/manga\//, "").replace(/^\/manga\//, "").replace(/\/$/, ""),
        chapter: link.text().trim(),
        title: null,
        pages: 0,
        language: "ar",
        publishAt: dateEl?.text()?.trim() || undefined,
      };
    }).filter(Boolean);
  },

  async pageUrls(chapterId) {
    const doc = await getDoc("/manga/" + chapterId + "/");
    return doc.querySelectorAll(".reading-content img").map((img) => {
      return abs(img.attr("src") || img.attr("data-src") || img.attr("data-lazy-src"));
    }).filter(Boolean);
  }
};
