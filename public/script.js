const form = document.getElementById('altForm');
const imageInput = document.getElementById('image');
const previewImg = document.getElementById('previewImg');
const imageDropArea = document.getElementById('imageDropArea');
const imageDropText = document.getElementById('imageDropText');

const resultBox = document.getElementById('resultBox');
const altTextArea = document.getElementById('altText');
const charCount = document.getElementById('charCount');
const copyBtn = document.getElementById('copyBtn');
const rerunBtn = document.getElementById('rerunBtn');
const translateBtn = document.getElementById('translateBtn');
const spinner = document.getElementById('spinner');
const errorBox = document.getElementById('errorBox');
const submitBtn = document.getElementById('submitBtn');

const translationsBox = document.getElementById('translationsBox');
const translationsDiv = document.getElementById('translations');
const csvWarning = document.getElementById('csvWarning');

let lastFormData = null;
let lastAlt = null;

// ---- Drag & Drop for Image Upload ----

imageDropArea.addEventListener('click', () => {
  imageInput.click();
});

['dragenter', 'dragover'].forEach(eventName => {
  imageDropArea.addEventListener(eventName, e => {
    e.preventDefault();
    e.stopPropagation();
    imageDropArea.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach(eventName => {
  imageDropArea.addEventListener(eventName, e => {
    e.preventDefault();
    e.stopPropagation();
    imageDropArea.classList.remove('dragover');
  });
});

imageDropArea.addEventListener('drop', e => {
  e.preventDefault();
  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
    imageInput.files = e.dataTransfer.files;
    handleImagePreview(e.dataTransfer.files[0]);
  }
});

// On input change (for drag-and-drop or click)
imageInput.addEventListener('change', function () {
  const file = imageInput.files[0];
  handleImagePreview(file);
});

function handleImagePreview(file) {
  if (file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      previewImg.src = e.target.result;
      previewImg.style.display = 'block';
      imageDropText.style.display = 'none';
    }
    reader.readAsDataURL(file);
  } else {
    previewImg.style.display = 'none';
    imageDropText.style.display = 'block';
  }
}

// ---- Alt Text Generation, Copy, Rerun, Translate ----

function showSpinner(show) {
  spinner.style.display = show ? 'block' : 'none';
  submitBtn.disabled = show;
  rerunBtn.disabled = show;
  translateBtn.disabled = show;
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.style.display = "block";
}

function hideError() {
  errorBox.style.display = "none";
}

function updateAltUI(alt) {
  altTextArea.value = alt;
  const len = alt.length;
  charCount.textContent = len + " chars";
  if (len < 115 || len > 130) {
    altTextArea.classList.add('red');
    charCount.classList.add('red');
  } else {
    altTextArea.classList.remove('red');
    charCount.classList.remove('red');
  }
  altTextArea.removeAttribute("readonly");
  resultBox.style.display = 'block';
  translateBtn.style.display = 'inline-block';
  translationsBox.style.display = 'none';
  translationsDiv.innerHTML = '';
}

form.addEventListener('submit', async function (e) {
  e.preventDefault();
  hideError();
  resultBox.style.display = 'none';
  translationsBox.style.display = 'none';
  showSpinner(true);

  const formData = new FormData(form);
  lastFormData = new FormData(form);

  try {
    const res = await fetch('/generate', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || "Unknown error");
      console.error(data);
      return;
    }

    updateAltUI(data.alt);
    lastAlt = data.alt;
    if (data.isCustomCsvStale) {
      csvWarning.style.display = "block";
    } else {
      csvWarning.style.display = "none";
    }
  } catch (err) {
    showError("Failed to generate alt text.");
    console.error(err);
  } finally {
    showSpinner(false);
  }
});

// Copy button
copyBtn.addEventListener('click', () => {
  altTextArea.select();
  document.execCommand('copy');
  copyBtn.textContent = "Copied!";
  setTimeout(() => {
    copyBtn.textContent = "Copy";
  }, 900);
});

// Rerun button
rerunBtn.addEventListener('click', async () => {
  if (!lastFormData) return;
  hideError();
  resultBox.style.display = 'none';
  translationsBox.style.display = 'none';
  showSpinner(true);
  try {
    const res = await fetch('/generate', {
      method: 'POST',
      body: lastFormData
    });
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || "Unknown error");
      console.error(data);
      return;
    }
    updateAltUI(data.alt);
    lastAlt = data.alt;
    if (data.isCustomCsvStale) {
      csvWarning.style.display = "block";
    } else {
      csvWarning.style.display = "none";
    }
  } catch (err) {
    showError("Failed to rerun.");
    console.error(err);
  } finally {
    showSpinner(false);
  }
});

// Translate button
translateBtn.addEventListener('click', async () => {
  hideError();
  translationsBox.style.display = 'none';
  translationsDiv.innerHTML = '';
  showSpinner(true);

  const text = altTextArea.value;

  try {
    const res = await fetch('/translate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ text })
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || "Unknown translation error");
      console.error(data);
      return;
    }

    // Show all translations, all editable, each with a Copy button
    translationsBox.style.display = 'block';
    translationsDiv.innerHTML = '';
    const langOrder = [
      { code: 'si', label: 'SI' },
      { code: 'hr', label: 'HR' },
      { code: 'it', label: 'IT' },
      { code: 'de', label: 'DE' },
      { code: 'fr', label: 'FR' },
      { code: 'es', label: 'ES' },
      { code: 'pt', label: 'PT' },
    ];
    langOrder.forEach(l => {
        const value = data.translations[l.code] || "";
        const block = document.createElement('div');
        block.className = "translation-block";
        block.innerHTML = `
            <label for="translation_${l.code}">${l.label}</label>
            <textarea class="translation-textarea" id="translation_${l.code}" rows="3">${value}</textarea>
            <button class="material-btn copy-translation-btn" data-lang="${l.code}" tabindex="-1" style="margin-top:0.3rem;width:100%;">Copy</button>
        `;
        translationsDiv.appendChild(block);
    });

    // Add copy event listeners to translation Copy buttons
    document.querySelectorAll('.copy-translation-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        const lang = btn.getAttribute('data-lang');
        const textarea = document.getElementById('translation_' + lang);
        textarea.select();
        document.execCommand('copy');
        btn.textContent = "Copied!";
        setTimeout(() => {
          btn.textContent = "Copy";
        }, 900);
      });
    });

    if (data.isCustomCsvStale) {
      csvWarning.style.display = "block";
    } else {
      csvWarning.style.display = "none";
    }
  } catch (err) {
    showError("Failed to translate alt text.");
    console.error(err);
  } finally {
    showSpinner(false);
  }
});
