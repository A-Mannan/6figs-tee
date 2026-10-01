export function productTierLabel(teeTierId) {
    if (teeTierId === 1)
        return "I";
    if (teeTierId === 2 || teeTierId === 3)
        return "II";
    if (teeTierId === 4)
        return "III";
    return null;
}
