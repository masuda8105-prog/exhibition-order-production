// Pagination is part of the PDF, never delegated to Safari's webpage printer.
export async function createOrderPdf(receiptCard, sharing) {
  const css = await fetch(new URL('./styles.css', import.meta.url)).then(response => { if (!response.ok) throw new Error('PDF_STYLE_LOAD'); return response.text(); });
  const { jsPDF } = window.jspdf;
  const html2canvas = window.html2canvas;
  const frame = document.createElement("iframe");
  frame.title = "PDF作成用";
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;pointer-events:none";
  document.body.append(frame);
  try {
    const doc = frame.contentDocument;
    doc.open();
    doc.write('<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body><section id="printArea"><div id="receiptCard"></div></section></body></html>');
    doc.close();
    const base = doc.createElement("base"); base.href = document.baseURI; doc.head.append(base);
    const style = doc.createElement("style");
    style.textContent = css.replace(/@media print/g, "@media all").replace(/@media screen/g, "@media not all")
      .replace(/body(?::not\(\.receiptOnly\))?\s*>\s*\*?:not\(#printArea\)\s*\{[^}]*\}/g, "")
      + '\nhtml,body{width:794px!important;margin:0!important} #printArea{display:block!important;width:794px!important} .printSheet{width:194mm!important;min-height:0!important;margin:0!important}';
    doc.head.append(style);
    doc.body.dataset.printCopy = sharing ? "sharing" : "both";
    const card = doc.getElementById("receiptCard");
    for (const node of receiptCard.querySelectorAll(".printSheet")) card.append(node.cloneNode(true));
    if (sharing) for (const node of receiptCard.querySelectorAll(".shareAttachmentPage")) card.append(node.cloneNode(true));
    await Promise.all([...card.querySelectorAll("img")].map(img => img.decode()));
    await doc.fonts.ready;
    const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
    pdf.setProperties({ title: "注文書", creator: "SAN NISHIMURA" });
    let pages = 0;
    for (const node of card.children) {
      const attachment = node.classList.contains("shareAttachmentPage");
      const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff", logging: false, windowWidth: 794, windowHeight: 1123, scrollX: 0, scrollY: 0, ignoreElements: el => attachment && el.tagName === "IMG" });
      if (!canvas.width || !canvas.height) {
        const r=node.getBoundingClientRect();
        throw new Error(`PDF画像を作成できませんでした（${canvas.width}x${canvas.height}, ${r.width}x${r.height}）。`);
      }
      if (attachment) {
        if (pages++) pdf.addPage();
        const scale = Math.min(194 / canvas.width, 277 / canvas.height);
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", (210-canvas.width*scale)/2, 10, canvas.width*scale, canvas.height*scale);
        const photo=node.querySelector("img");
        const raster=doc.createElement("canvas");
        raster.width=photo.naturalWidth; raster.height=photo.naturalHeight;
        raster.getContext("2d").drawImage(photo,0,0);
        const fit=Math.min(194/raster.width,180/raster.height);
        pdf.addImage(raster.toDataURL("image/jpeg",0.95),"JPEG",(210-raster.width*fit)/2,34,raster.width*fit,raster.height*fit);
        raster.width=raster.height=1;
      } else {
        // Keep ordinary rows together when a long order needs extra pages.
        const bounds = node.getBoundingClientRect();
        const ratio = canvas.width / bounds.width;
        const breaks = [...node.querySelectorAll("tr,.receiptHeaderSimple,.receiptInfoBand,.receiptPickupNumber,.receiptFooterGrid,.receiptFooterMini")]
          .flatMap(el => { const r = el.getBoundingClientRect(); return [Math.floor((r.top-bounds.top)*ratio), Math.ceil((r.bottom-bounds.top)*ratio)]; });
        const capacity = Math.floor(canvas.width * 277 / 194);
        for (let top=0; top<canvas.height;) {
          let end = Math.min(canvas.height, top+capacity);
          if (end<canvas.height) {
            const safe = breaks.filter(y=>y>top+capacity/2 && y<=end);
            if (safe.length) end=Math.max(...safe);
          }
          const slice = doc.createElement("canvas");
          slice.width=canvas.width; slice.height=end-top;
          slice.getContext("2d").drawImage(canvas,0,top,canvas.width,end-top,0,0,canvas.width,end-top);
          if (pages++) pdf.addPage();
          pdf.addImage(slice.toDataURL("image/jpeg",0.95),"JPEG",8,10,194,slice.height*194/slice.width);
          slice.width=slice.height=1;
          top=end;
        }
      }
      canvas.width=canvas.height=1;
    }
    return { blob: pdf.output("blob"), pages };
  } finally { frame.remove(); }
}

