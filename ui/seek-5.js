(() => {
  const back = document.getElementById('back30');
  const forward = document.getElementById('forward30');

  if (back) {
    back.id = 'back5';
    back.textContent = '−5 sn';
    back.title = '5 saniye geri';
    back.onclick = () => seek(currentTick - tickRate() * 5);
  }

  if (forward) {
    forward.id = 'forward5';
    forward.textContent = '+5 sn';
    forward.title = '5 saniye ileri';
    forward.onclick = () => seek(currentTick + tickRate() * 5);
  }
})();
