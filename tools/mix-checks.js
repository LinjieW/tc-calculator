/* Run against the production page with tools/wkcheck.swift. */
(function () {
  var fail = [], panel = document.getElementById('secMix');
  var slice = document.querySelector('.mix-slice');
  var row = document.querySelector('.mix-row');
  function hover(el) { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); }
  function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  function clear(name) {
    if (document.querySelector('.mix-slice.is-active, .mix-slice.is-dim, .mix-row[aria-pressed="true"]')) fail.push(name);
  }
  function pin(el) {
    hover(el); click(el);
    if (!document.querySelector('.mix-row[aria-pressed="true"]')) fail.push('pin failed');
  }
  var original = document.getElementById('heroVal').textContent;
  pin(slice); click(panel); clear('panel blank did not clear');
  pin(slice); click(document.getElementById('mixChart')); clear('donut centre did not clear');
  pin(row); click(document.querySelector('.page-title')); clear('outside did not clear');
  pin(row); click(row); clear('repeat click left highlight');
  pin(row); row.focus();
  document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}));
  clear('Escape left highlight');
  if (document.activeElement !== row) fail.push('Escape moved focus');
  hover(slice); hover(panel); clear('hover stuck on panel blank');
  pin(slice);
  var second = document.querySelectorAll('.mix-row')[1]; click(second);
  if (second.getAttribute('aria-pressed') !== 'true') fail.push('switch slice failed');
  click(panel); clear('final clear failed');
  if (document.getElementById('heroVal').textContent !== original) fail.push('selection changed result');
  window.__RESULT = JSON.stringify({pass:!fail.length,fail:fail,viewport:innerWidth});
}());
