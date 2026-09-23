document.addEventListener("DOMContentLoaded", function () {
  const bookElement = document.getElementById("my-book");

  const pageFlip = new St.PageFlip(bookElement, {
    width: 400,
    height: 600,
    size: "fixed",
    minWidth: 250,
    minHeight: 375,
    maxWidth: 1200,
    maxHeight: 1800,
    usePortrait: true,
    flippingTime: 500,
    startZIndex: 1,
    autoSize: true,
    drawShadow: true,
    maxShadowOpacity: 0.15,
    showCover: true,
    useMouseEvents: true,
  });

  // Load pages
  pageFlip.loadFromHTML(document.querySelectorAll(".my-page"));
  const tocLinks = document.querySelectorAll(".toc-link");
  tocLinks.forEach(function (link) {
    // Thư viện page-flip quyết định "có lật trang hay không" ngay từ lúc
    // nhấn chuột/chạm xuống (mousedown/touchstart), TRƯỚC KHI sự kiện click
    // xảy ra. Nếu chỉ chặn ở "click" thì đã quá trễ: cú lật đã được kích
    // hoạt rồi. Chặn lan truyền ngay từ mousedown/touchstart để link mục lục
    // không bao giờ bị hiểu nhầm thành thao tác lật, trong khi các chỗ khác
    // trong sách vẫn lật bình thường khi bấm.
    ["mousedown", "touchstart", "pointerdown"].forEach(function (evt) {
      link.addEventListener(evt, function (e) {
        e.stopPropagation();
      });
    });

    link.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const pageIndex = parseInt(this.dataset.page);

      // Dùng turnToPage() thay vì flip(): flip() có animation lật và được
      // thiết kế cho việc lật từng trang gần nhau (Next/Prev). Khi nhảy xa
      // (ví dụ từ trang mục lục sang trang 18), flip() phải tính toán qua
      // nhiều trang trung gian nên đôi khi tính sai và nhảy lộn đến trang
      // khác (VD trang bìa cuối). turnToPage() nhảy thẳng đến đúng trang,
      // không animation, nên luôn chính xác.
      pageFlip.turnToPage(pageIndex);
      updatePageIndicator();
    });
  });

  // Buttons
  const btnPrev = document.getElementById("btn-prev");
  const btnNext = document.getElementById("btn-next");
  const pageIndicator = document.getElementById("page-indicator");
  const pageInput = document.getElementById("page-input");
  const btnGoto = document.getElementById("btn-goto");

  // Previous
  btnPrev.addEventListener("click", function () {
    pageFlip.flipPrev();
  });

  // Next
  btnNext.addEventListener("click", function () {
    pageFlip.flipNext();
  });

  // Go to page
  btnGoto.addEventListener("click", function () {
    const pageNum = parseInt(pageInput.value, 10);
    const totalPages = pageFlip.getPageCount();

    if (isNaN(pageNum) || pageNum < 1 || pageNum > totalPages) {
      alert(`Vui lòng nhập số trang từ 1 đến ${totalPages}`);
      return;
    }

    const targetIndex = pageNum - 1;

    // turnToPage(): nhảy thẳng đến trang, không animation -> không bị tính
    // sai hướng lật / nhảy lộn trang như khi dùng flip() để đi xa nhiều trang.
    pageFlip.turnToPage(targetIndex);
    updatePageIndicator();
    pageInput.value = "";
    pageInput.blur();
  });

  // Cho phép nhấn Enter để đi đến trang
  pageInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
      btnGoto.click();
    }
  });

  // Page number
  function updatePageIndicator() {
    const currentPage = pageFlip.getCurrentPageIndex() + 1;
    const totalPages = pageFlip.getPageCount();

    pageIndicator.textContent = `Trang ${currentPage} / ${totalPages}`;
  }

  // Sự kiện "flip" chỉ chắc chắn bắn ra khi lật có animation (flipNext/flipPrev).
  // turnToPage() không animation nên ta tự cập nhật chỉ số trang ngay sau khi gọi.
  pageFlip.on("flip", updatePageIndicator);

  // Responsive
  let resizeTimer;

  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      pageFlip.update();
    }, 250);
  });

  // Mobile orientation
  window.addEventListener("orientationchange", function () {
    setTimeout(function () {
      pageFlip.update();
    }, 500);
  });
});
