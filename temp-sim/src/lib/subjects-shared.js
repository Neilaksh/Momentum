"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUBJECT_COLORS = void 0;
exports.subjectColorHex = subjectColorHex;
/** Small preset palette for subject colors. */
exports.SUBJECT_COLORS = [
    { key: "lime", label: "Lime", hex: "#a3e635" },
    { key: "sky", label: "Sky", hex: "#38bdf8" },
    { key: "rose", label: "Rose", hex: "#fb7185" },
    { key: "amber", label: "Amber", hex: "#fbbf24" },
    { key: "violet", label: "Violet", hex: "#a78bfa" },
    { key: "teal", label: "Teal", hex: "#2dd4bf" },
];
function subjectColorHex(color) {
    const found = exports.SUBJECT_COLORS.find((c) => c.key === color);
    return found?.hex ?? exports.SUBJECT_COLORS[0].hex;
}
