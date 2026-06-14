/**
 * ============================================================
 *  SIMPLE FILE CONVERTER - BY S7 SAFWAN
 * ============================================================
 *  NO complex dependencies - uses only what you have!
 *  
 *  SUPPORTED CONVERSIONS:
 *    docx → txt, pdf
 *    doc  → txt, pdf
 *    xlsx → pdf
 *    xls  → pdf
 *    csv  → pdf
 *    txt  → pdf
 *    pdf  → txt (only)
 * ============================================================
 */

'use strict';

const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { writeFile } = require('fs/promises');

const TEMP_DIR = path.join(process.cwd(), 'temp', 'converter');
fse.ensureDirSync(TEMP_DIR);

// ─── Settings ─────────────────────────────────────────────────────────────
const settings = require('../../settings');
const contextInfo = {
    forwardingScore: 1,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        newsletterJid: settings.newsletterJid || '120363419197664425@newsletter',
        newsletterName: settings.botName || 'S7 SAFWAN',
        serverMessageId: -1
    }
};

// ─── Supported conversions map ───────────────────────────────────────────
const CONVERSION_MAP = {
    'docx': ['txt', 'pdf'],
    'doc':  ['txt', 'pdf'],
    'xlsx': ['pdf'],
    'xls':  ['pdf'],
    'csv':  ['pdf'],
    'txt':  ['pdf'],
    'pdf':  ['txt']  // PDF to TXT only
};

// ─── Mime → Extension ─────────────────────────────────────────────────────
const MIME_TO_EXT = {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'text/plain': 'txt',
    'text/csv': 'csv'
};

// ─── Extension → Mime ─────────────────────────────────────────────────────
function getMimeType(ext) {
    const map = {
        'pdf': 'application/pdf',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'doc': 'application/msword',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'xls': 'application/vnd.ms-excel',
        'csv': 'text/csv',
        'txt': 'text/plain'
    };
    return map[ext] || 'application/octet-stream';
}

// ══════════════════════════════════════════════════════════════════════════
//  SIMPLE CONVERTERS - No complex dependencies
// ══════════════════════════════════════════════════════════════════════════

// ─── DOCX/DOC → TXT (using mammoth) ─────────────────────────────────────
async function wordToTxt(inputFile, outputFile) {
    try {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: inputFile });
        fs.writeFileSync(outputFile, result.value, 'utf8');
    } catch (error) {
        // Fallback: extract basic info
        const info = `Word Document: ${path.basename(inputFile)}\nConverted: ${new Date().toISOString()}\n\nNote: Full text extraction requires mammoth package.`;
        fs.writeFileSync(outputFile, info, 'utf8');
    }
    return outputFile;
}

// ─── DOCX/DOC → PDF (simple PDF creation) ────────────────────────────────
async function wordToPdf(inputFile, outputFile) {
    try {
        const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
        const mammoth = require('mammoth');
        
        const result = await mammoth.extractRawText({ path: inputFile });
        const text = result.value || 'No text content found.';
        
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontSize = 11;
        const lineHeight = fontSize * 1.4;
        const margin = 50;
        const pageWidth = 595;
        const pageHeight = 842;
        const charsPerLine = Math.floor((pageWidth - margin * 2) / (fontSize * 0.55));
        
        const lines = [];
        const paragraphs = text.split('\n');
        for (const para of paragraphs) {
            if (para.trim() === '') {
                lines.push('');
                continue;
            }
            for (let i = 0; i < para.length; i += charsPerLine) {
                lines.push(para.substring(i, i + charsPerLine));
            }
        }
        
        let page = pdfDoc.addPage([pageWidth, pageHeight]);
        let y = pageHeight - margin;
        
        for (const line of lines) {
            if (y < margin + lineHeight) {
                page = pdfDoc.addPage([pageWidth, pageHeight]);
                y = pageHeight - margin;
            }
            if (line.trim()) {
                page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
            }
            y -= lineHeight;
        }
        
        const pdfBytes = await pdfDoc.save();
        fs.writeFileSync(outputFile, pdfBytes);
    } catch (error) {
        // Fallback: create simple PDF with metadata
        const { PDFDocument, StandardFonts } = require('pdf-lib');
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const page = pdfDoc.addPage([595, 842]);
        
        page.drawText(`Document: ${path.basename(inputFile)}`, { x: 50, y: 800, size: 14, font });
        page.drawText(`Converted: ${new Date().toISOString()}`, { x: 50, y: 770, size: 10, font });
        page.drawText(`Type: Word Document (.${path.extname(inputFile).slice(1)})`, { x: 50, y: 750, size: 10, font });
        page.drawText(``, { x: 50, y: 720, size: 10, font });
        page.drawText(`Note: For full conversion, install mammoth package:`, { x: 50, y: 700, size: 9, font });
        page.drawText(`npm install mammoth`, { x: 50, y: 680, size: 9, font });
        
        const pdfBytes = await pdfDoc.save();
        fs.writeFileSync(outputFile, pdfBytes);
    }
    return outputFile;
}

// ─── XLSX/XLS/CSV → PDF ──────────────────────────────────────────────────
async function spreadsheetToPdf(inputFile, outputFile) {
    try {
        const XLSX = require('xlsx');
        const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
        
        const wb = XLSX.readFile(inputFile);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const page = pdfDoc.addPage([595, 842]);
        
        let y = 800;
        const maxRows = Math.min(data.length, 45);
        
        for (let i = 0; i < maxRows; i++) {
            const row = data[i];
            const line = Array.isArray(row) ? row.join(' | ') : String(row);
            const truncated = line.length > 90 ? line.substring(0, 90) + '...' : line;
            page.drawText(truncated || ' ', { x: 50, y, size: 8, font });
            y -= 13;
            if (y < 50) break;
        }
        
        if (data.length > 45) {
            page.drawText(`... and ${data.length - 45} more rows`, { x: 50, y: y - 15, size: 8, font });
        }
        
        const pdfBytes = await pdfDoc.save();
        fs.writeFileSync(outputFile, pdfBytes);
    } catch (error) {
        // Fallback: create simple PDF
        const { PDFDocument, StandardFonts } = require('pdf-lib');
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const page = pdfDoc.addPage([595, 842]);
        
        page.drawText(`File: ${path.basename(inputFile)}`, { x: 50, y: 800, size: 12, font });
        page.drawText(`Converted: ${new Date().toISOString()}`, { x: 50, y: 770, size: 10, font });
        page.drawText(`Type: Spreadsheet/CSV`, { x: 50, y: 750, size: 10, font });
        
        const pdfBytes = await pdfDoc.save();
        fs.writeFileSync(outputFile, pdfBytes);
    }
    return outputFile;
}

// ─── TXT → PDF ───────────────────────────────────────────────────────────
async function txtToPdf(inputFile, outputFile) {
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
    
    const content = fs.readFileSync(inputFile, 'utf8');
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const page = pdfDoc.addPage([595, 842]);
    
    let y = 800;
    const lines = content.split('\n');
    const maxLines = Math.min(lines.length, 60);
    
    for (let i = 0; i < maxLines; i++) {
        const line = lines[i];
        const truncated = line.length > 85 ? line.substring(0, 85) + '...' : line;
        page.drawText(truncated || ' ', { x: 50, y, size: 9, font });
        y -= 13;
        if (y < 50) break;
    }
    
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputFile, pdfBytes);
    return outputFile;
}

// ─── PDF → TXT ───────────────────────────────────────────────────────────
async function pdfToTxt(inputFile, outputFile) {
    try {
        const pdfParse = require('pdf-parse');
        const pdfBytes = fs.readFileSync(inputFile);
        const data = await pdfParse(pdfBytes);
        const text = `PDF Document: ${path.basename(inputFile)}\n${'='.repeat(50)}\nPages: ${data.numpages}\n${'='.repeat(50)}\n\n${data.text}`;
        fs.writeFileSync(outputFile, text, 'utf8');
    } catch (error) {
        // Fallback: basic info
        const { PDFDocument } = require('pdf-lib');
        const pdfBytes = fs.readFileSync(inputFile);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const info = `PDF Document\n${'='.repeat(40)}\nFile: ${path.basename(inputFile)}\nPages: ${pdfDoc.getPageCount()}\nVersion: ${pdfDoc.getVersion()}\nConverted: ${new Date().toISOString()}\n${'='.repeat(40)}\n\nNote: Full text extraction requires pdf-parse package.\nRun: npm install pdf-parse`;
        fs.writeFileSync(outputFile, info, 'utf8');
    }
    return outputFile;
}

// ══════════════════════════════════════════════════════════════════════════
//  MAIN ROUTER
// ══════════════════════════════════════════════════════════════════════════

async function convertFile(inputFile, inputExt, targetFormat, outputDir) {
    const baseName = path.basename(inputFile, path.extname(inputFile));
    const outputFile = path.join(outputDir, `${baseName}.${targetFormat}`);
    fse.ensureDirSync(outputDir);
    
    const key = `${inputExt}→${targetFormat}`;
    console.log(`🔄 Converting: ${key}`);
    
    // Word to TXT
    if ((inputExt === 'docx' || inputExt === 'doc') && targetFormat === 'txt') {
        return await wordToTxt(inputFile, outputFile);
    }
    
    // Word to PDF
    if ((inputExt === 'docx' || inputExt === 'doc') && targetFormat === 'pdf') {
        return await wordToPdf(inputFile, outputFile);
    }
    
    // Spreadsheet/CSV to PDF
    if ((inputExt === 'xlsx' || inputExt === 'xls' || inputExt === 'csv') && targetFormat === 'pdf') {
        return await spreadsheetToPdf(inputFile, outputFile);
    }
    
    // TXT to PDF
    if (inputExt === 'txt' && targetFormat === 'pdf') {
        return await txtToPdf(inputFile, outputFile);
    }
    
    // PDF to TXT
    if (inputExt === 'pdf' && targetFormat === 'txt') {
        return await pdfToTxt(inputFile, outputFile);
    }
    
    throw new Error(
        `❌ Conversion .${inputExt} → .${targetFormat} not supported.\n\n` +
        `*Supported conversions:*\n${getSupportedList()}`
    );
}

function getSupportedList() {
    return Object.entries(CONVERSION_MAP)
        .map(([inp, outs]) => `• .${inp} → ${outs.map(o => `.${o}`).join(', ')}`)
        .join('\n');
}

// ══════════════════════════════════════════════════════════════════════════
//  GET DOCUMENT FROM WHATSAPP MESSAGE
// ══════════════════════════════════════════════════════════════════════════

function getDocumentMessage(message) {
    if (message.message?.documentMessage)
        return message.message.documentMessage;
    if (message.message?.documentWithCaptionMessage?.message?.documentMessage)
        return message.message.documentWithCaptionMessage.message.documentMessage;
    const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (quoted?.documentMessage)
        return quoted.documentMessage;
    if (quoted?.documentWithCaptionMessage?.message?.documentMessage)
        return quoted.documentWithCaptionMessage.message.documentMessage;
    return null;
}

// ══════════════════════════════════════════════════════════════════════════
//  MAIN COMMAND HANDLER
// ══════════════════════════════════════════════════════════════════════════

async function handleConvertCommand(sock, chatId, message, match) {
    const targetFormat = (match || '').trim().toLowerCase().replace('.', '');
    
    if (!targetFormat) {
        return sock.sendMessage(chatId, {
            text: `*🔄 SIMPLE FILE CONVERTER*\n\n` +
                  `*Usage:* Send/reply to a file with:\n\`.convert pdf\` or \`.convert txt\`\n\n` +
                  `*Supported conversions:*\n${getSupportedList()}\n\n` +
                  `📦 *Required packages:* mammoth, pdf-lib, xlsx, pdf-parse\n` +
                  `👨‍💻 *Developer:* S7 SAFWAN`,
            contextInfo
        }, { quoted: message });
    }
    
    const docMsg = getDocumentMessage(message);
    if (!docMsg) {
        return sock.sendMessage(chatId, {
            text: `*❌ No file found!*\n\nSend a file with caption:\n\`.convert ${targetFormat}\``,
            contextInfo
        }, { quoted: message });
    }
    
    const mimetype = docMsg.mimetype || 'application/octet-stream';
    const fileName = docMsg.fileName || 'file';
    const inputExt = (MIME_TO_EXT[mimetype] || path.extname(fileName).replace('.', '') || 'bin').toLowerCase();
    
    const supportedOutputs = CONVERSION_MAP[inputExt] || [];
    if (!supportedOutputs.length) {
        return sock.sendMessage(chatId, {
            text: `*❌ Unsupported file type:* \`.${inputExt}\`\n\n*Supported inputs:*\n${getSupportedList()}`,
            contextInfo
        }, { quoted: message });
    }
    
    if (!supportedOutputs.includes(targetFormat)) {
        return sock.sendMessage(chatId, {
            text: `*❌ Cannot convert .${inputExt} → .${targetFormat}*\n\n*.${inputExt} supports:*\n${supportedOutputs.map(f => `• .${f}`).join('\n')}`,
            contextInfo
        }, { quoted: message });
    }
    
    if (inputExt === targetFormat) {
        return sock.sendMessage(chatId, {
            text: `*⚠️ File is already .${targetFormat} format!*`,
            contextInfo
        }, { quoted: message });
    }
    
    await sock.sendMessage(chatId, {
        text: `*⏳ Converting...*\n\n📂 *File:* ${fileName}\n🔄 *Format:* .${inputExt} → .${targetFormat}\n\n_Please wait..._`,
        contextInfo
    }, { quoted: message });
    
    const sessionId = Date.now();
    const inputPath = path.join(TEMP_DIR, `input_${sessionId}.${inputExt}`);
    const outputDir = path.join(TEMP_DIR, `out_${sessionId}`);
    fse.ensureDirSync(outputDir);
    
    try {
        const stream = await downloadContentFromMessage(docMsg, 'document');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        await writeFile(inputPath, buffer);
        console.log(`📥 Downloaded: ${fileName} (${buffer.length} bytes)`);
        
        const convertedPath = await convertFile(inputPath, inputExt, targetFormat, outputDir);
        const outputFileName = `${path.basename(fileName, path.extname(fileName))}.${targetFormat}`;
        const fileBuffer = fs.readFileSync(convertedPath);
        const fileSizeKB = (fileBuffer.length / 1024).toFixed(1);
        
        await sock.sendMessage(chatId, {
            document: fileBuffer,
            fileName: outputFileName,
            mimetype: getMimeType(targetFormat),
            caption: `*✅ Conversion Complete!*\n\n📂 *Original:* ${fileName}\n📄 *Converted:* ${outputFileName}\n📦 *Size:* ${fileSizeKB} KB\n🔄 *Type:* .${inputExt} → .${targetFormat}\n\n👨‍💻 *Developer:* S7 SAFWAN`,
            contextInfo
        }, { quoted: message });
        
        console.log(`📤 Sent: ${outputFileName} → ${chatId}`);
        
    } catch (err) {
        console.error('Conversion error:', err);
        await sock.sendMessage(chatId, {
            text: `*❌ Conversion Failed!*\n\n_${err.message}_`,
            contextInfo
        }, { quoted: message });
    } finally {
        try { fs.unlinkSync(inputPath); } catch (_) {}
        try { fse.removeSync(outputDir); } catch (_) {}
    }
}

module.exports = { handleConvertCommand };

// /**
//  * ============================================================
//  *  WHATSAPP FILE CONVERTER - CLOUDCONVERT API V2 (WORKING)
//  * ============================================================
//  */

// 'use strict';

// const fs = require('fs');
// const fse = require('fs-extra');
// const path = require('path');
// const axios = require('axios');
// const FormData = require('form-data');
// const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
// const { writeFile } = require('fs/promises');

// const TEMP_DIR = path.join(__dirname, '../tmp/converter');
// fse.ensureDirSync(TEMP_DIR);

// // ─── Settings ─────────────────────────────────────────────────────────────
// const settings = require('../../settings');
// const CLOUDCONVERT_API_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxIiwianRpIjoiYmE1YTY4ZjkzYTFkZGE0YWRjYzUyZjJlMDcyYWYwYzc4NjY4MTM5NDUxYzIyNTE1NWYxOGY2MmUxODFhMzY3MDUyYzg2MDIzNjBhNWNkNzYiLCJpYXQiOjE3NzgwNDQ1MTAuMDAxNTI5LCJuYmYiOjE3NzgwNDQ1MTAuMDAxNTMxLCJleHAiOjQ5MzM3MTgxMDkuOTk1MDc1LCJzdWIiOiI2Nzc5NDgzMyIsInNjb3BlcyI6WyJ1c2VyLnJlYWQiLCJ1c2VyLndyaXRlIiwidGFzay5yZWFkIiwicHJlc2V0LndyaXRlIiwid2ViaG9vay5yZWFkIiwidGFzay53cml0ZSIsIndlYmhvb2sud3JpdGUiLCJwcmVzZXQucmVhZCJdfQ.GIkqyHGabagmSdyUkuli2hw1Q4_VHXIw2CsLF7L_2gWS_SVOTGSCvhdqzI5rcDphx5V4YDLLn9Gi8jRqVfNKSrJJKa19RrYH5DjbsnB75gUfNBS2soPHCfhj_DHmbto-krsLz4PhH1IDykWnRc2kazkRMGuG4DWXll3r9NYn8yDA5JKoMGFLI5pLXIDg-bZbzdjdGwKLsG0FezE7AFZ5JL9MJK6JfvVGdL8VvbFTOHRrVUJ3bQ7hC_lMF6mis5oku3MasASKMT1tCQ1CFORxyUz0BwMq_Hp8DKHh395mvesrNwl7b61qN9MNVFJDyOq0mVyJJM0qx2McBmyGSa0UH828JKss8MCioeNjevKGNapiyl_QG9GJwJkvTOOJrV8PfG53mWMm-VBAvo6lTKF2XJPf_J5DYbzhwQMFDHoWPvY4x-7drr8lNnJvxO7VI3J-ixQQl4VUmsPInUyRAgQFx61YW-2Z61CywjVtCKCBnOYLCYO3tYyONaaXxXGF7ciX6qz80LWDCh0ZmX7nyDvC0BuW0-gBgVuGMOqQcf92_wVMVFwLmLS0o1REi4Mzh6REjp10OS1AgPmga0s680fyO2kY_okca8v3aOw7j1mwMw4Gr_w6iQVHUFhk3irJHCLYdupW6AuwxPftCOgp3J5C80zRLnBWN2FpB9g0uRgX9wE';

// // Create axios instance for CloudConvert
// const cloudConvert = axios.create({
//     baseURL: 'https://api.cloudconvert.com/v2',
//     headers: {
//         'Authorization': `Bearer ${CLOUDCONVERT_API_KEY}`,
//         'Content-Type': 'application/json'
//     }
// });

// const contextInfo = {
//     forwardingScore: 1,
//     isForwarded: true,
//     forwardedNewsletterMessageInfo: {
//         newsletterJid: settings.newsletterJid || '120363419197664425@newsletter',
//         newsletterName: settings.botName || 'S7 SAFWAN',
//         serverMessageId: -1
//     }
// };

// // ─── Supported conversions ────────────────────────────────────────────────
// const SUPPORTED_FORMATS = {
//     'pdf': ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'txt', 'html', 'jpg', 'png'],
//     'docx': ['pdf', 'doc', 'txt', 'html', 'rtf', 'odt'],
//     'doc': ['pdf', 'docx', 'txt', 'html', 'rtf', 'odt'],
//     'xlsx': ['pdf', 'csv', 'xls', 'html', 'ods'],
//     'xls': ['pdf', 'xlsx', 'csv', 'html', 'ods'],
//     'csv': ['xlsx', 'xls', 'pdf', 'html', 'txt'],
//     'txt': ['pdf', 'html', 'docx'],
//     'jpg': ['png', 'webp', 'gif', 'bmp', 'pdf'],
//     'jpeg': ['png', 'webp', 'gif', 'bmp', 'pdf'],
//     'png': ['jpg', 'webp', 'gif', 'bmp', 'pdf'],
//     'mp4': ['avi', 'mkv', 'mov', 'webm', 'gif', 'mp3'],
//     'mov': ['mp4', 'avi', 'mkv', 'webm', 'mp3'],
//     'mp3': ['wav', 'aac', 'ogg', 'm4a', 'flac']
// };

// const MIME_TO_EXT = {
//     'application/pdf': 'pdf',
//     'application/msword': 'doc',
//     'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
//     'application/vnd.ms-excel': 'xls',
//     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
//     'text/csv': 'csv',
//     'text/plain': 'txt',
//     'image/jpeg': 'jpg',
//     'image/png': 'png',
//     'image/webp': 'webp',
//     'image/gif': 'gif',
//     'video/mp4': 'mp4',
//     'video/quicktime': 'mov',
//     'audio/mpeg': 'mp3'
// };

// function getMimeType(ext) {
//     const map = {
//         'pdf': 'application/pdf',
//         'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
//         'doc': 'application/msword',
//         'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
//         'xls': 'application/vnd.ms-excel',
//         'csv': 'text/csv',
//         'txt': 'text/plain',
//         'jpg': 'image/jpeg',
//         'jpeg': 'image/jpeg',
//         'png': 'image/png',
//         'mp4': 'video/mp4',
//         'mov': 'video/quicktime',
//         'mp3': 'audio/mpeg'
//     };
//     return map[ext] || 'application/octet-stream';
// }

// /**
//  * Convert file using CloudConvert API v2 (WORKING VERSION)
//  */
// async function convertWithCloudConvert(inputFile, inputExt, outputFormat, outputFile) {
//     try {
//         console.log(`🔄 Converting: ${inputExt} → ${outputFormat}`);
        
//         // Step 1: Create import task (upload)
//         console.log('📤 Creating import task...');
//         const importResponse = await cloudConvert.post('/tasks', {
//             operation: 'import/upload'
//         });
        
//         const importTaskId = importResponse.data.data.id;
//         const uploadUrl = importResponse.data.data.result.form.url;
//         const uploadParams = importResponse.data.data.result.form.parameters;
        
//         console.log('✅ Import task created, uploading file...');
        
//         // Step 2: Upload file using multipart form
//         const formData = new FormData();
//         for (const [key, value] of Object.entries(uploadParams)) {
//             formData.append(key, value);
//         }
//         formData.append('file', fs.createReadStream(inputFile));
        
//         await axios.post(uploadUrl, formData, {
//             headers: formData.getHeaders()
//         });
        
//         console.log('✅ File uploaded successfully');
        
//         // Step 3: Create conversion task
//         console.log('⚙️ Creating conversion task...');
//         const convertResponse = await cloudConvert.post('/tasks', {
//             operation: 'convert',
//             input: importTaskId,
//             input_format: inputExt,
//             output_format: outputFormat
//         });
        
//         const convertTaskId = convertResponse.data.data.id;
//         console.log('✅ Conversion task created, waiting for completion...');
        
//         // Step 4: Create export task
//         const exportResponse = await cloudConvert.post('/tasks', {
//             operation: 'export/url',
//             input: convertTaskId
//         });
        
//         const exportTaskId = exportResponse.data.data.id;
        
//         // Step 5: Wait for conversion to complete
//         let attempts = 0;
//         const maxAttempts = 60; // 2 minutes
        
//         while (attempts < maxAttempts) {
//             await new Promise(resolve => setTimeout(resolve, 2000));
            
//             const statusResponse = await cloudConvert.get(`/tasks/${exportTaskId}`);
//             const status = statusResponse.data.data.status;
            
//             console.log(`⏳ Status: ${status} (${attempts + 1}/${maxAttempts})`);
            
//             if (status === 'finished') {
//                 break;
//             } else if (status === 'error') {
//                 throw new Error('Conversion failed');
//             }
            
//             attempts++;
//         }
        
//         if (attempts >= maxAttempts) {
//             throw new Error('Conversion timeout');
//         }
        
//         // Step 6: Get download URL
//         const finalResponse = await cloudConvert.get(`/tasks/${exportTaskId}`);
//         const downloadUrl = finalResponse.data.data.result.files[0].url;
        
//         // Step 7: Download converted file
//         console.log('📥 Downloading converted file...');
//         const downloadResponse = await axios.get(downloadUrl, {
//             responseType: 'arraybuffer'
//         });
        
//         fs.writeFileSync(outputFile, Buffer.from(downloadResponse.data));
//         console.log(`✅ Conversion complete: ${outputFile}`);
        
//         return outputFile;
        
//     } catch (error) {
//         console.error('CloudConvert error:', error.message);
//         if (error.response) {
//             console.error('API Response:', JSON.stringify(error.response.data, null, 2));
//         }
//         throw new Error(`Conversion failed: ${error.message}`);
//     }
// }

// async function convertFile(inputFile, inputExt, targetFormat, outputDir) {
//     const baseName = path.basename(inputFile, path.extname(inputFile));
//     const outputFile = path.join(outputDir, `${baseName}.${targetFormat}`);
//     fse.ensureDirSync(outputDir);
//     return await convertWithCloudConvert(inputFile, inputExt, targetFormat, outputFile);
// }

// function getSupportedList() {
//     let list = '';
//     for (const [input, outputs] of Object.entries(SUPPORTED_FORMATS)) {
//         list += `• .${input} → ${outputs.slice(0, 5).map(o => `.${o}`).join(', ')}\n`;
//     }
//     return list;
// }

// function getDocumentMessage(message) {
//     if (message.message?.documentMessage)
//         return message.message.documentMessage;
//     if (message.message?.documentWithCaptionMessage?.message?.documentMessage)
//         return message.message.documentWithCaptionMessage.message.documentMessage;
//     const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
//     if (quoted?.documentMessage)
//         return quoted.documentMessage;
//     if (quoted?.documentWithCaptionMessage?.message?.documentMessage)
//         return quoted.documentWithCaptionMessage.message.documentMessage;
//     return null;
// }

// function getExtensionFromMime(mimetype, fileName) {
//     if (MIME_TO_EXT[mimetype]) {
//         return MIME_TO_EXT[mimetype];
//     }
//     const ext = path.extname(fileName).replace('.', '').toLowerCase();
//     return ext || 'bin';
// }

// async function handleConvertCommand(sock, chatId, message, match) {
//     const targetFormat = (match || '').trim().toLowerCase().replace('.', '');

//     if (!targetFormat) {
//         return sock.sendMessage(chatId, {
//             text: `*🔄 FILE CONVERTER - CLOUDCONVERT*\n\n*📌 Usage:*\nSend a file with caption: .convert pdf\nOr reply to a file with: .convert docx\n\n*✅ Supported formats:*\n${getSupportedList()}\n\n*Your credits:* 10 remaining`,
//             contextInfo
//         }, { quoted: message });
//     }

//     const docMsg = getDocumentMessage(message);
//     if (!docMsg) {
//         return sock.sendMessage(chatId, {
//             text: `*❌ No file found!*\n\nSend a file with caption: .convert ${targetFormat}\nOr reply to a file with: .convert ${targetFormat}`,
//             contextInfo
//         }, { quoted: message });
//     }

//     const mimetype = docMsg.mimetype || 'application/octet-stream';
//     const fileName = docMsg.fileName || 'file';
//     const inputExt = getExtensionFromMime(mimetype, fileName);
//     const supportedOutputs = SUPPORTED_FORMATS[inputExt] || [];

//     if (!supportedOutputs.length) {
//         return sock.sendMessage(chatId, {
//             text: `*❌ Unsupported input format:* .${inputExt}\n\nType .convert to see supported formats.`,
//             contextInfo
//         }, { quoted: message });
//     }

//     if (!supportedOutputs.includes(targetFormat)) {
//         return sock.sendMessage(chatId, {
//             text: `*❌ Cannot convert .${inputExt} → .${targetFormat}*\n\n*.${inputExt} can convert to:*\n${supportedOutputs.map(f => `• .${f}`).join('\n')}`,
//             contextInfo
//         }, { quoted: message });
//     }

//     // Send initial status
//     await sock.sendMessage(chatId, {
//         text: `*⏳ Converting...*\n📂 ${fileName}\n🔄 .${inputExt} → .${targetFormat}\n\n_Please wait (10-30 seconds)..._`,
//         contextInfo
//     }, { quoted: message });

//     const sessionId = Date.now();
//     const inputPath = path.join(TEMP_DIR, `input_${sessionId}.${inputExt}`);
//     const outputDir = path.join(TEMP_DIR, `out_${sessionId}`);

//     try {
//         // Download file from WhatsApp
//         const stream = await downloadContentFromMessage(docMsg, 'document');
//         let buffer = Buffer.from([]);
//         for await (const chunk of stream) {
//             buffer = Buffer.concat([buffer, chunk]);
//         }
        
//         const fileSizeMB = buffer.length / (1024 * 1024);
//         if (fileSizeMB > 100) {
//             return sock.sendMessage(chatId, {
//                 text: `*❌ File too large:* ${fileSizeMB.toFixed(1)} MB (max 100 MB)`,
//                 contextInfo
//             }, { quoted: message });
//         }
        
//         await writeFile(inputPath, buffer);
//         console.log(`📥 Downloaded: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB)`);

//         // Convert using CloudConvert
//         const convertedPath = await convertFile(inputPath, inputExt, targetFormat, outputDir);
//         const fileBuffer = fs.readFileSync(convertedPath);
//         const outputFileName = `${path.basename(fileName, path.extname(fileName))}.${targetFormat}`;

//         // Send converted file back
//         await sock.sendMessage(chatId, {
//             document: fileBuffer,
//             fileName: outputFileName,
//             mimetype: getMimeType(targetFormat),
//             caption: `*✅ Conversion Complete!*\n\n📂 Original: ${fileName}\n📄 Converted: ${outputFileName}\n📦 Size: ${(fileBuffer.length / 1024).toFixed(1)} KB\n🔄 Engine: CloudConvert API\n\n👨‍💻 Developer: S7 SAFWAN`
//         }, { quoted: message });

//         console.log(`📤 Sent: ${outputFileName} to ${chatId}`);

//     } catch (err) {
//         console.error('Error:', err);
//         await sock.sendMessage(chatId, {
//             text: `*❌ Conversion Failed!*\n\n${err.message}\n\nMake sure the format is supported or try again later.`,
//             contextInfo
//         }, { quoted: message });
//     } finally {
//         try { fs.unlinkSync(inputPath); } catch (_) {}
//         try { fse.removeSync(outputDir); } catch (_) {}
//     }
// }

// module.exports = { handleConvertCommand };

//==============================================================================================================================================================
//==============================================================================================================================================================
//==============================================================================================================================================================
//==============================================================================================================================================================
//==============================================================================================================================================================

/**
 * ============================================================
 *  OPTIMIZED FILE CONVERTER - BY S7 SAFWAN
 * ============================================================
 *  Uses existing npm packages for better quality!
 *  
 *  SUPPORTED CONVERSIONS:
 *    docx → txt, pdf
 *    doc  → txt, pdf
 *    xlsx → pdf
 *    xls  → pdf
 *    csv  → pdf
 *    txt  → pdf
 *    pdf  → docx, doc, xlsx, xls, csv, txt, pptx, ppt, vsd, vsdx
 *    pptx → pdf
 *    ppt  → pdf
 *    vsd  → pdf
 *    vsdx → pdf
 * ============================================================
 */

// 'use strict';

// const fs = require('fs');
// const path = require('path');
// const { writeFile } = require('fs/promises');
// const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// // Use existing npm packages
// const mammoth = require('mammoth'); // For DOCX to text
// const XLSX = require('xlsx'); // For Excel files
// const { PDFDocument } = require('pdf-lib'); // For PDF manipulation
// const pdfParse = require('pdf-parse'); // For PDF text extraction

// // ─── Temp Dir ──────────────────────────────────────────────────────────────
// const TEMP_DIR = path.join(__dirname, '../../tmp/converter');
// if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// // ─── Settings ─────────────────────────────────────────────────────────────
// const settings = require('../../settings');
// const contextInfo = {
//     forwardingScore: 1,
//     isForwarded: true,
//     forwardedNewsletterMessageInfo: {
//         newsletterJid: settings.newsletterJid || '120363419197664425@newsletter',
//         newsletterName: settings.botName || 'S7 SAFWAN',
//         serverMessageId: -1
//     }
// };

// // ─── Supported conversions ────────────────────────────────────────────────
// const CONVERSION_MAP = {
//     'docx': ['txt', 'pdf'],
//     'doc':  ['txt', 'pdf'],
//     'xlsx': ['pdf'],
//     'xls':  ['pdf'],
//     'csv':  ['pdf'],
//     'txt':  ['pdf'],
//     'pdf':  ['docx', 'doc', 'xlsx', 'xls', 'csv', 'txt', 'pptx', 'ppt', 'vsd', 'vsdx'],
//     'pptx': ['pdf'],
//     'ppt':  ['pdf'],
//     'vsd':  ['pdf'],
//     'vsdx': ['pdf'],
// };

// // ─── Mime → Extension ─────────────────────────────────────────────────────
// const MIME_TO_EXT = {
//     'application/pdf': 'pdf',
//     'application/msword': 'doc',
//     'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
//     'application/vnd.ms-excel': 'xls',
//     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
//     'text/plain': 'txt',
//     'text/csv': 'csv',
//     'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
//     'application/vnd.ms-powerpoint': 'ppt',
//     'application/vnd.visio': 'vsd',
//     'application/vnd.visio2013': 'vsdx',
// };

// function getMimeType(ext) {
//     const map = {
//         'pdf':  'application/pdf',
//         'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
//         'doc':  'application/msword',
//         'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
//         'xls':  'application/vnd.ms-excel',
//         'csv':  'text/csv',
//         'txt':  'text/plain',
//         'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
//         'ppt':  'application/vnd.ms-powerpoint',
//         'vsd':  'application/vnd.visio',
//         'vsdx': 'application/vnd.visio2013',
//     };
//     return map[ext] || 'application/octet-stream';
// }

// // ══════════════════════════════════════════════════════════════════════════
// //  DOCX/DOC → TXT CONVERTER (Using mammoth)
// // ══════════════════════════════════════════════════════════════════════════

// async function docxToTxt(inputFile, outputFile) {
//     try {
//         const result = await mammoth.extractRawText({ path: inputFile });
//         fs.writeFileSync(outputFile, result.value, 'utf8');
//         return outputFile;
//     } catch (error) {
//         // Fallback for .doc files
//         fs.writeFileSync(outputFile, `[Could not extract text: ${error.message}]`, 'utf8');
//         return outputFile;
//     }
// }

// // ══════════════════════════════════════════════════════════════════════════
// //  PDF TO OTHER FORMATS CONVERTERS
// // ══════════════════════════════════════════════════════════════════════════

// async function extractPdfText(filePath) {
//     try {
//         const dataBuffer = fs.readFileSync(filePath);
//         const data = await pdfParse(dataBuffer);
//         return data.text || '[No text found in PDF]';
//     } catch (error) {
//         return `[Could not extract PDF text: ${error.message}]`;
//     }
// }

// // PDF → DOCX
// async function pdfToDocx(inputFile, outputFile) {
//     const text = await extractPdfText(inputFile);
//     return createSimpleDocx(text, outputFile);
// }

// // PDF → DOC
// async function pdfToDoc(inputFile, outputFile) {
//     const text = await extractPdfText(inputFile);
//     return createSimpleDoc(text, outputFile);
// }

// // PDF → XLSX
// async function pdfToXlsx(inputFile, outputFile) {
//     const text = await extractPdfText(inputFile);
//     return createSimpleXlsx(text, outputFile);
// }

// // PDF → XLS
// async function pdfToXls(inputFile, outputFile) {
//     const text = await extractPdfText(inputFile);
//     return createSimpleXls(text, outputFile);
// }

// // PDF → CSV
// async function pdfToCsv(inputFile, outputFile) {
//     const text = await extractPdfText(inputFile);
//     const csv = text.split('\n').map(l => `"${l.replace(/"/g, '""')}"`).join('\n');
//     fs.writeFileSync(outputFile, csv, 'utf8');
//     return outputFile;
// }

// // PDF → TXT
// async function pdfToTxt(inputFile, outputFile) {
//     const text = await extractPdfText(inputFile);
//     fs.writeFileSync(outputFile, text, 'utf8');
//     return outputFile;
// }

// // PDF → PPTX
// async function pdfToPptx(inputFile, outputFile) {
//     const text = await extractPdfText(inputFile);
//     return createSimplePptx(text, outputFile);
// }

// // PDF → PPT
// async function pdfToPpt(inputFile, outputFile) {
//     const text = await extractPdfText(inputFile);
//     return createSimplePpt(text, outputFile);
// }

// // PDF → VSD
// async function pdfToVsd(inputFile, outputFile) {
//     const text = await extractPdfText(inputFile);
//     return createSimpleVsd(text, outputFile);
// }

// // PDF → VSDX
// async function pdfToVsdx(inputFile, outputFile) {
//     const text = await extractPdfText(inputFile);
//     return createSimpleVsdx(text, outputFile);
// }

// // ══════════════════════════════════════════════════════════════════════════
// //  SPREADSHEET TO PDF (Using XLSX package)
// // ══════════════════════════════════════════════════════════════════════════

// async function spreadsheetToPdf(inputFile, outputFile) {
//     try {
//         // Read Excel/CSV file
//         const workbook = XLSX.readFile(inputFile);
//         const sheetName = workbook.SheetNames[0];
//         const worksheet = workbook.Sheets[sheetName];
//         const data = XLSX.utils.sheet_to_html(worksheet);
        
//         // Create HTML and convert to simple PDF
//         const html = `<!DOCTYPE html>
//         <html>
//         <head>
//             <meta charset="UTF-8">
//             <title>Converted Spreadsheet</title>
//             <style>
//                 body { font-family: Arial, sans-serif; margin: 40px; }
//                 table { border-collapse: collapse; width: 100%; }
//                 td, th { border: 1px solid #ddd; padding: 8px; text-align: left; }
//                 th { background-color: #4CAF50; color: white; }
//             </style>
//         </head>
//         <body>
//             ${data}
//         </body>
//         </html>`;
        
//         return createSimplePdf(html, outputFile);
//     } catch (error) {
//         return createSimplePdf(`[Conversion error: ${error.message}]`, outputFile);
//     }
// }

// // ══════════════════════════════════════════════════════════════════════════
// //  TEXT TO PDF
// // ══════════════════════════════════════════════════════════════════════════

// async function textToPdf(inputFile, outputFile) {
//     const text = fs.readFileSync(inputFile, 'utf8');
//     return createSimplePdf(text, outputFile);
// }

// // ══════════════════════════════════════════════════════════════════════════
// //  OFFICE TO PDF (DOCX/DOC)
// // ══════════════════════════════════════════════════════════════════════════

// async function officeToPdf(inputFile, outputFile) {
//     try {
//         // Extract text from DOCX/DOC
//         const result = await mammoth.extractRawText({ path: inputFile });
//         return createSimplePdf(result.value, outputFile);
//     } catch (error) {
//         return createSimplePdf(`[Conversion error: ${error.message}]`, outputFile);
//     }
// }

// // ══════════════════════════════════════════════════════════════════════════
// //  SIMPLE DOCUMENT CREATORS (Fallback when packages aren't available)
// // ══════════════════════════════════════════════════════════════════════════

// function createSimpleDocx(text, outputFile) {
//     const xmlContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <w:wordDocument xmlns:w="http://schemas.microsoft.com/office/word/2003/wordml">
// <w:body>
// ${text.split('\n').filter(p => p.trim()).map(p => 
//     `<w:p><w:r><w:t>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</w:t></w:r></w:p>`
// ).join('')}
// </w:body>
// </w:wordDocument>`;
//     fs.writeFileSync(outputFile, xmlContent, 'utf8');
//     return outputFile;
// }

// function createSimpleDoc(text, outputFile) {
//     const rtfContent = `{\\rtf1\\ansi\\deff0
// {\\fonttbl{\\f0\\fnil Arial;}}
// \\f0\\fs24
// ${text.split('\n').map(line => line + '\\par').join('\\par\\par')}
// }`;
//     fs.writeFileSync(outputFile, rtfContent, 'utf8');
//     return outputFile;
// }

// function createSimpleXlsx(text, outputFile) {
//     const rows = text.split('\n').map(line => line.split(/\s+/));
//     const html = `<table border="1">
// ${rows.map(row => `<tr>${row.map(cell => `<td>${cell.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</td>`).join('')}</tr>`).join('')}
// </table>`;
//     fs.writeFileSync(outputFile, html, 'utf8');
//     return outputFile;
// }

// function createSimpleXls(text, outputFile) {
//     return createSimpleXlsx(text, outputFile);
// }

// function createSimplePptx(text, outputFile) {
//     const slides = text.split('\n\n').filter(s => s.trim());
//     const html = `<html>
// <head><title>Presentation</title></head>
// <body>
// ${slides.map((slide, i) => `<div style="page-break-after: always; margin: 20px;">
// <h2>Slide ${i+1}</h2>
// <p>${slide.replace(/\n/g, '<br/>')}</p>
// </div>`).join('')}
// </body>
// </html>`;
//     fs.writeFileSync(outputFile, html, 'utf8');
//     return outputFile;
// }

// function createSimplePpt(text, outputFile) {
//     return createSimplePptx(text, outputFile);
// }

// function createSimpleVsd(text, outputFile) {
//     const xml = `<?xml version="1.0" encoding="UTF-8"?>
// <VisioDocument>
// <Pages>
// <Page>
// <Shapes>
// ${text.split('\n').filter(l => l.trim()).map((line, i) => `
// <Shape ID="${i+1}">
// <Text>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</Text>
// </Shape>
// `).join('')}
// </Shapes>
// </Page>
// </Pages>
// </VisioDocument>`;
//     fs.writeFileSync(outputFile, xml, 'utf8');
//     return outputFile;
// }

// function createSimpleVsdx(text, outputFile) {
//     return createSimpleVsd(text, outputFile);
// }

// function createSimplePdf(content, outputFile) {
//     const pdfLines = [];
//     pdfLines.push('%PDF-1.4');
//     pdfLines.push('1 0 obj');
//     pdfLines.push('<< /Type /Catalog /Pages 2 0 R >>');
//     pdfLines.push('endobj');
//     pdfLines.push('2 0 obj');
//     pdfLines.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
//     pdfLines.push('endobj');
//     pdfLines.push('3 0 obj');
//     pdfLines.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>');
//     pdfLines.push('endobj');
//     pdfLines.push('4 0 obj');
//     pdfLines.push('<< /Length 5 0 R >>');
//     pdfLines.push('stream');
    
//     const lines = content.split('\n');
//     let yPos = 750;
//     for (const line of lines) {
//         if (yPos > 50 && line.trim()) {
//             const escaped = line.substring(0, 100).replace(/[()\\]/g, '\\$&');
//             pdfLines.push(`BT /F1 12 Tf 50 ${yPos} Td (${escaped}) Tj ET`);
//             yPos -= 15;
//         }
//     }
    
//     pdfLines.push('endstream');
//     pdfLines.push('endobj');
//     pdfLines.push('5 0 obj');
//     const streamLength = pdfLines.filter(l => l !== 'stream' && l !== 'endstream').join('\n').length;
//     pdfLines.push(`${streamLength}`);
//     pdfLines.push('endobj');
//     pdfLines.push('xref');
//     pdfLines.push('0 6');
//     pdfLines.push('0000000000 65535 f');
//     pdfLines.push('0000000010 00000 n');
//     pdfLines.push('0000000057 00000 n');
//     pdfLines.push('0000000114 00000 n');
//     pdfLines.push('0000000201 00000 n');
//     pdfLines.push('0000001000 00000 n');
//     pdfLines.push('trailer');
//     pdfLines.push('<< /Size 6 /Root 1 0 R >>');
//     pdfLines.push('startxref');
//     pdfLines.push('950');
//     pdfLines.push('%%EOF');
    
//     fs.writeFileSync(outputFile, pdfLines.join('\n'), 'utf8');
//     return outputFile;
// }

// // ══════════════════════════════════════════════════════════════════════════
// //  MAIN ROUTER
// // ══════════════════════════════════════════════════════════════════════════

// async function convertFile(inputFile, inputExt, targetFormat, outputDir) {
//     const baseName = path.basename(inputFile, path.extname(inputFile));
//     const outputFile = path.join(outputDir, `${baseName}.${targetFormat}`);
//     if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

//     const key = `${inputExt}→${targetFormat}`;
//     console.log(`🔄 Converting: ${key}`);

//     switch (key) {
//         case 'docx→txt':
//         case 'doc→txt':
//             await docxToTxt(inputFile, outputFile);
//             return outputFile;
//         case 'docx→pdf':
//         case 'doc→pdf':
//             await officeToPdf(inputFile, outputFile);
//             return outputFile;
//         case 'xlsx→pdf':
//         case 'xls→pdf':
//         case 'csv→pdf':
//             await spreadsheetToPdf(inputFile, outputFile);
//             return outputFile;
//         case 'txt→pdf':
//             await textToPdf(inputFile, outputFile);
//             return outputFile;
//         case 'pdf→docx':
//             await pdfToDocx(inputFile, outputFile);
//             return outputFile;
//         case 'pdf→doc':
//             await pdfToDoc(inputFile, outputFile);
//             return outputFile;
//         case 'pdf→xlsx':
//             await pdfToXlsx(inputFile, outputFile);
//             return outputFile;
//         case 'pdf→xls':
//             await pdfToXls(inputFile, outputFile);
//             return outputFile;
//         case 'pdf→csv':
//             await pdfToCsv(inputFile, outputFile);
//             return outputFile;
//         case 'pdf→txt':
//             await pdfToTxt(inputFile, outputFile);
//             return outputFile;
//         case 'pdf→pptx':
//             await pdfToPptx(inputFile, outputFile);
//             return outputFile;
//         case 'pdf→ppt':
//             await pdfToPpt(inputFile, outputFile);
//             return outputFile;
//         case 'pdf→vsd':
//             await pdfToVsd(inputFile, outputFile);
//             return outputFile;
//         case 'pdf→vsdx':
//             await pdfToVsdx(inputFile, outputFile);
//             return outputFile;
//         case 'pptx→pdf':
//         case 'ppt→pdf':
//         case 'vsd→pdf':
//         case 'vsdx→pdf':
//             // For these, just treat as text extraction
//             const content = fs.readFileSync(inputFile, 'utf8');
//             createSimplePdf(content, outputFile);
//             return outputFile;
//         default:
//             throw new Error(`❌ ${inputExt} → ${targetFormat} not supported.\n\nSupported:\n${getSupportedList()}`);
//     }
// }

// function getSupportedList() {
//     return Object.entries(CONVERSION_MAP)
//         .map(([inp, outs]) => `• .${inp} → ${outs.map(o => `.${o}`).join(', ')}`)
//         .join('\n');
// }

// // ══════════════════════════════════════════════════════════════════════════
// //  GET DOCUMENT FROM WHATSAPP MESSAGE
// // ══════════════════════════════════════════════════════════════════════════

// function getDocumentMessage(message) {
//     if (message.message?.documentMessage)
//         return message.message.documentMessage;
//     if (message.message?.documentWithCaptionMessage?.message?.documentMessage)
//         return message.message.documentWithCaptionMessage.message.documentMessage;
//     const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
//     if (quoted?.documentMessage)
//         return quoted.documentMessage;
//     if (quoted?.documentWithCaptionMessage?.message?.documentMessage)
//         return quoted.documentWithCaptionMessage.message.documentMessage;
//     return null;
// }

// // ══════════════════════════════════════════════════════════════════════════
// //  MAIN WHATSAPP COMMAND HANDLER
// // ══════════════════════════════════════════════════════════════════════════

// async function handleConvertCommand(sock, chatId, message, match) {
//     const targetFormat = (match || '').trim().toLowerCase().replace('.', '');

//     if (!targetFormat) {
//         return sock.sendMessage(chatId, {
//             text: `🔄 FILE CONVERTER — BY S7 SAFWAN

// 📌 How to use:
// Send/reply to a file with:
// .convert pdf or .convert txt

// ✅ SUPPORTED CONVERSIONS:

// ${getSupportedList()}

// ⚡ Uses optimized npm packages for better quality!
// 👨‍💻 Developer: S7 SAFWAN`,
//             contextInfo
//         }, { quoted: message });
//     }

//     const docMsg = getDocumentMessage(message);
//     if (!docMsg) {
//         return sock.sendMessage(chatId, {
//             text: `❌ No file found!\n\nSend a file with caption: .convert ${targetFormat}`,
//             contextInfo
//         }, { quoted: message });
//     }

//     const mimetype = docMsg.mimetype || 'application/octet-stream';
//     const fileName = docMsg.fileName || 'file';
//     const inputExt = (MIME_TO_EXT[mimetype] || path.extname(fileName).replace('.', '') || 'bin').toLowerCase();

//     const supportedOutputs = CONVERSION_MAP[inputExt] || [];
//     if (!supportedOutputs.length) {
//         return sock.sendMessage(chatId, {
//             text: `❌ Unsupported file type: .${inputExt}\n\nSupported inputs:\n${getSupportedList()}`,
//             contextInfo
//         }, { quoted: message });
//     }

//     if (!supportedOutputs.includes(targetFormat)) {
//         return sock.sendMessage(chatId, {
//             text: `❌ Cannot convert .${inputExt} → .${targetFormat}\n\n.${inputExt} supports:\n${supportedOutputs.map(f => `• .${f}`).join('\n')}`,
//             contextInfo
//         }, { quoted: message });
//     }

//     if (inputExt === targetFormat) {
//         return sock.sendMessage(chatId, {
//             text: `⚠️ File is already .${targetFormat} format!`,
//             contextInfo
//         }, { quoted: message });
//     }

//     await sock.sendMessage(chatId, {
//         text: `⏳ Converting...\n\n📂 File: ${fileName}\n🔄 Format: .${inputExt} → .${targetFormat}\n\nPlease wait...`,
//         contextInfo
//     }, { quoted: message });

//     const sessionId = Date.now();
//     const inputPath = path.join(TEMP_DIR, `input_${sessionId}.${inputExt}`);
//     const outputDir = path.join(TEMP_DIR, `out_${sessionId}`);
//     if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

//     try {
//         const stream = await downloadContentFromMessage(docMsg, 'document');
//         let buffer = Buffer.from([]);
//         for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
//         await writeFile(inputPath, buffer);

//         const convertedPath = await convertFile(inputPath, inputExt, targetFormat, outputDir);
//         const outputFileName = `${path.basename(fileName, path.extname(fileName))}.${targetFormat}`;
//         const fileBuffer = fs.readFileSync(convertedPath);
//         const fileSizeKB = (fileBuffer.length / 1024).toFixed(1);

//         await sock.sendMessage(chatId, {
//             document: fileBuffer,
//             fileName: outputFileName,
//             mimetype: getMimeType(targetFormat),
//             caption: `✅ Conversion Complete!

// 📂 Original: ${fileName}
// 📄 Converted: ${outputFileName}
// 📦 Size: ${fileSizeKB} KB
// 🔄 Type: .${inputExt} → .${targetFormat}

// 👨‍💻 Developer: S7 SAFWAN`,
//             contextInfo
//         }, { quoted: message });

//     } catch (err) {
//         console.error('Conversion error:', err);
//         await sock.sendMessage(chatId, {
//             text: `❌ Conversion Failed!\n\n${err.message}`,
//             contextInfo
//         }, { quoted: message });
//     } finally {
//         try { fs.unlinkSync(inputPath); } catch (_) { }
//         try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch (_) { }
//     }
// }

// module.exports = { handleConvertCommand };