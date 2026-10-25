// Sayfa kabuğu (vakalar.html): sol şeritteki sekmeler paneli açar/kapatır. Haritayı app.js çizer;
// #mapbox'ın ResizeObserver'ı panel açılıp kapanınca tuvali yeniden boyutlandırır.
(function () {
  const side = document.getElementById('side');
  const tabs = document.querySelectorAll('.rail .tab[data-tab]');
  let cur = null;
  function openTab(id) {
    cur = id; side.hidden = !id;
    tabs.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === id)));
    document.querySelectorAll('.pane').forEach(p => { p.hidden = p.dataset.pane !== id; });
    window.dispatchEvent(new Event('resize'));   // 3B görünüm pencere boyutunu dinliyor
  }
  tabs.forEach(b => b.addEventListener('click', () => openTab(cur === b.dataset.tab ? null : b.dataset.tab)));
  document.getElementById('sideClose').addEventListener('click', () => openTab(null));
  // telefonda harita önce görünsün; vaka seçince panel kapanır ki harita görünsün
  const phone = () => matchMedia('(max-width: 640px)').matches;
  openTab(phone() ? null : 'vaka');
  document.querySelectorAll('.cs, #list').forEach(el => el.addEventListener('click', () => { if (phone()) setTimeout(() => openTab(null), 50); }));
})();
