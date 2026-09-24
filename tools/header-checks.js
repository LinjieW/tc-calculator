/* Production-page checks for the compact effective tax rate. */
(async function () {
  var fail = [], info = [], rate = document.querySelector('.tl-rate');
  function ok(x, name) { if (!x) fail.push(name); }
  function wait() { return new Promise(r => setTimeout(r, 400)); }
  function set(id, value) { var e = document.getElementById(id); e.value=value; e.dispatchEvent(new Event('input',{bubbles:true})); }
  document.documentElement.style.scrollBehavior='auto';
  var initialHeight=document.querySelector('.topbar').getBoundingClientRect().height;
  window.scrollTo(0,600); await wait();
  ok(Math.abs(document.querySelector('.topbar').getBoundingClientRect().height-initialHeight)<=1,'collapse changed header height');
  for (var precision of [0,2]) {
    document.querySelector('[data-prec="'+precision+'"]').click(); await wait();
    var title=document.getElementById('topbarTitle');
    rate=title.querySelector('.tl-rate');
    var value=title.querySelector('.tl-rate-val').textContent;
    ok(value===(precision===0?'19.5%':'19.48%'),'expected effective rate '+precision);
    ok(value===document.getElementById('tEff').textContent,'tax panel parity');
    ok(document.documentElement.scrollWidth===innerWidth,'document overflow');
    ok(document.querySelector('.topbar').getBoundingClientRect().height<=64,'header wrapped');
    {
      ok(getComputedStyle(rate).display!=='none','rate hidden');
      ok(title.scrollWidth<=title.clientWidth+1,'readout clipped');
      var r=rate.getBoundingClientRect(),tools=document.querySelector('.topbar-tools').getBoundingClientRect();
      ok(r.right<=tools.left,'overlaps controls');
    }
    for(var e of title.querySelectorAll('.tl-total,.tl-take,.tl-rate')) {
      var box=e.getBoundingClientRect(), parent=title.getBoundingClientRect();
      ok(box.width>0 && box.left>=parent.left-1 && box.right<=parent.right+1 && box.bottom<=parent.bottom+1,'readout outside title');
      ok(e.scrollWidth<=e.clientWidth+1,'individual readout clipped');
    }
    info.push({precision,value,width:innerWidth,titleWidth:title.clientWidth,content:title.scrollWidth});
  }
  set('aBase',0);set('aBonus',0);set('hExact',0);await wait();
  ok(document.querySelector('.tl-rate-val').textContent==='—','zero income rate');
  window.__RESULT=JSON.stringify({pass:!fail.length,fail,info});
}());
