export function useTr() {
    return (english: string, german: string) => (window as any).__appLanguage === "de" ? german : english
}
