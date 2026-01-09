// --- 1. BIẾN TRẠNG THÁI ---
let currentChapterNumber = 1;
let generatedFiles = []; // Mảng chứa object: { id, name, blob, selected }

// --- 2. CÁC DOM ELEMENT ---
const chapterNumInput = document.getElementById('chapterNumInput');
const nextChapterLabel = document.getElementById('nextChapterLabel');
const contentInput = document.getElementById('contentInput');
const fileListEl = document.getElementById('fileList');
const fileCountEl = document.getElementById('fileCount');
const selectAllCheckbox = document.getElementById('selectAll');

// Nút bấm
const btnProcess = document.getElementById('btnProcess');
const btnProcessClear = document.getElementById('btnProcessClear');
const btnReset = document.getElementById('btnReset');
const btnDownloadAll = document.getElementById('btnDownloadAll');

// --- 3. GẮN SỰ KIỆN (EVENT LISTENERS) ---

// Sự kiện thay đổi số chương
chapterNumInput.addEventListener('change', (e) => {
    let val = parseInt(e.target.value);
    if (val < 1 || isNaN(val)) val = 1;
    currentChapterNumber = val;
    updateUIState();
});

// Sự kiện các nút bấm
btnProcess.addEventListener('click', () => processChapter(false));
btnProcessClear.addEventListener('click', () => processChapter(true));
btnReset.addEventListener('click', resetChapterNumber);
btnDownloadAll.addEventListener('click', downloadSelected);
selectAllCheckbox.addEventListener('change', toggleSelectAll);

// Khởi tạo UI lần đầu
updateUIState();

// --- 4. CÁC HÀM LOGIC ---

function updateUIState() {
    chapterNumInput.value = currentChapterNumber;
    nextChapterLabel.innerText = currentChapterNumber + 1;
}

async function processChapter(clearAfter) {
    const text = contentInput.value;
    if (!text.trim()) {
        showToast("Vui lòng nhập nội dung chương!");
        return;
    }

    // Tạo file DOCX
    const docName = `Chương ${currentChapterNumber}.docx`;
    const blob = await createDocxBlob(text, `Chương ${currentChapterNumber}`);

    // Lưu vào danh sách
    const fileObj = {
        id: Date.now(),
        name: docName,
        blob: blob,
        chapterNum: currentChapterNumber
    };
    generatedFiles.push(fileObj);

    // Cập nhật Logic số chương
    currentChapterNumber++;
    updateUIState();

    // Xử lý ô nhập liệu
    if (clearAfter) {
        contentInput.value = "";
    }

    // Cập nhật Sidebar
    renderFileList();
    showToast(`Đã tạo: ${docName}`);
}

function createDocxBlob(textConent, title) {
    // Sử dụng thư viện docx từ window (do đã load ở CDN)
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = docx;

    // Tách dòng để tạo các đoạn văn
    const lines = textConent.split('\n');
    const paragraphs = lines.map(line => new Paragraph({
        children: [new TextRun({ text: line, size: 24 })], // Size 24 = 12pt
        spacing: { after: 120 }
    }));

    // Thêm tiêu đề chương vào đầu
    paragraphs.unshift(new Paragraph({
        text: title,
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { after: 240, before: 240 }
    }));

    const doc = new Document({
        sections: [{
            properties: {},
            children: paragraphs
        }]
    });

    return Packer.toBlob(doc);
}

function renderFileList() {
    fileCountEl.innerText = generatedFiles.length;
    fileListEl.innerHTML = "";

    if (generatedFiles.length === 0) {
        fileListEl.innerHTML = '<div style="text-align: center; color: #999; margin-top: 20px;">Chưa có chương nào được gộp</div>';
        return;
    }

    generatedFiles.forEach((file) => {
        const div = document.createElement('div');
        div.className = 'file-item';
        // Nút tải lẻ gắn hàm trực tiếp tại đây cho đơn giản
        div.innerHTML = `
            <input type="checkbox" class="file-check" data-id="${file.id}">
            <span class="file-name" title="${file.name}">${file.name}</span>
            <button class="btn-sm btn-primary download-single-btn" data-id="${file.id}">Tải</button>
        `;
        fileListEl.appendChild(div);
    });
    
    // Gắn sự kiện cho các nút tải lẻ vừa tạo
    document.querySelectorAll('.download-single-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            downloadSingle(parseInt(this.dataset.id));
        });
    });

    // Reset check all
    selectAllCheckbox.checked = false;
}

function resetChapterNumber() {
    if(confirm("Bạn có chắc chắn muốn reset số chương về 1? (Các file đã tạo sẽ không bị xóa)")) {
        currentChapterNumber = 1;
        updateUIState();
        showToast("Đã reset số chương về 1");
    }
}

function downloadSingle(id) {
    const file = generatedFiles.find(f => f.id === id);
    if (file) {
        saveAs(file.blob, file.name);
    }
}

function toggleSelectAll() {
    const checkboxes = document.querySelectorAll('.file-check');
    checkboxes.forEach(cb => cb.checked = selectAllCheckbox.checked);
}

function downloadSelected() {
    const checkboxes = document.querySelectorAll('.file-check:checked');
    if (checkboxes.length === 0) {
        showToast("Vui lòng chọn ít nhất 1 file để tải!");
        return;
    }

    const zip = new JSZip();
    let count = 0;

    checkboxes.forEach(cb => {
        const id = parseInt(cb.dataset.id);
        const file = generatedFiles.find(f => f.id === id);
        if (file) {
            zip.file(file.name, file.blob);
            count++;
        }
    });

    if (count > 0) {
        zip.generateAsync({type:"blob"}).then(function(content) {
            saveAs(content, `Truyen_Export_${Date.now()}.zip`);
            showToast(`Đang tải xuống ${count} file...`);
        });
    }
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}
