MINIMAL PATCH FOR app.js

Replace:

document.getElementById('gratis-btn')?.addEventListener('click', startGratisUpload);

With:

const gratisBtn = document.getElementById('gratis-btn');
if (gratisBtn) {
  gratisBtn.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    startGratisUpload();
  });
}

Add temporary debug line as first line inside startGratisUpload():

console.log('startGratisUpload fired');

This is a minimal change only and does not modify upload logic.
