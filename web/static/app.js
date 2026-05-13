(function () {
  var tapEl = document.getElementById('tap-id');
  var statusEl = document.getElementById('status');
  var armBtn = document.getElementById('arm-btn');

  function setIdle() {
    statusEl.textContent = '';
    statusEl.className = 'muted';
    armBtn.disabled = false;
  }

  armBtn.addEventListener('click', function () {
    armBtn.disabled = true;
    statusEl.textContent = 'Waiting for the next tap…';
    statusEl.className = 'live';

    fetch('/wait-tap')
      .then(function (res) {
        if (res.status === 408) {
          statusEl.textContent = 'Timed out. Tap did not arrive in time.';
          statusEl.className = 'dead';
          return null;
        }
        if (!res.ok) {
          statusEl.textContent = 'Request failed (' + res.status + ').';
          statusEl.className = 'dead';
          return null;
        }
        return res.json();
      })
      .then(function (data) {
        if (!data) {
          return;
        }
        tapEl.textContent = data.id;
        statusEl.textContent = 'Tap received. Press the button to wait again.';
        statusEl.className = 'muted';
      })
      .catch(function () {
        statusEl.textContent = 'Network error.';
        statusEl.className = 'dead';
      })
      .finally(function () {
        armBtn.disabled = false;
      });
  });

  setIdle();
})();
