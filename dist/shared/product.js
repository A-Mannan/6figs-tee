export function productTierLabel(teeTierId) {
    if (teeTierId === 1)
        return "I";
    if (teeTierId === 2)
        return "II";
    if (teeTierId === 3)
        return "III";
    if (teeTierId === 4)
        return "IV";
    return null;
}
