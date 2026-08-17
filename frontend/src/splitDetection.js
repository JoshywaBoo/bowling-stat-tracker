// splitDetection.js
export const SPLIT_GROUPS = [
    [[7, 10]],
    [[7, 9], [8, 10], [4, 6], [4, 6, 7], [4, 6, 10]],
    [[5, 7], [5, 10], [2, 6], [3, 4], [4, 9], [6, 8]],
    [[5, 7, 10]],
    [[3, 7], [2, 10]],
    [[2, 7], [3, 10], [2, 9], [3, 8]],
    [[2, 7, 10], [3, 7, 10]],
    [[4, 7, 10], [6, 7, 10], [4, 10], [6, 10]],
    [[4, 6, 7, 10]],
    [[2, 3], [4, 5], [5, 6], [7, 8], [8, 9], [9, 10]],
    [[4, 5, 7], [5, 6, 10], [2, 3, 4], [2, 3, 6], [4, 5, 8], [5, 6, 8]],
    [[4, 6, 7, 8, 10], [4, 6, 7, 9, 10], [4, 6, 8, 10], [4, 6, 7, 9]],
    [[3, 4, 6, 7, 10], [2, 4, 6, 7, 10]],
];

// Placeholder labels — rename these to whatever's meaningful later
// (e.g. "7-10 split", "Baby splits", "Big four").
export const SPLIT_GROUP_LABELS = SPLIT_GROUPS.map((_, i) => `Split group ${i + 1}`);

const SPLIT_PIN_SETS = SPLIT_GROUPS.flat().map(pins => new Set(pins));

export function standingPinNumbers(standingArr) {
    const nums = [];
    standingArr.forEach((standing, i) => { if (standing) nums.push(i + 1); });
    return nums;
}

export function isKnownSplit(standingArr) {
    const nums = standingPinNumbers(standingArr);
    if (!nums.length) return false;
    const set = new Set(nums);
    return SPLIT_PIN_SETS.some(s => s.size === set.size && [...s].every(p => set.has(p)));
}