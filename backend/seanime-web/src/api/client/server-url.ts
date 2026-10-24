import { __DEV_SERVER_PORT } from "@/lib/server/config"

function devOrProd(dev: string, prod: string): string {
    return import.meta.env.MODE === "development" ? dev : prod
}

export function getServerBaseUrl(removeProtocol: boolean = false): string {
    let ret = typeof window !== "undefined"
        ? (`${window?.location?.protocol}//` + devOrProd(`${window?.location?.hostname}:${__DEV_SERVER_PORT}`, window?.location?.host))
        : ""
    if (removeProtocol) {
        ret = ret.replace("http://", "").replace("https://", "")
    }
    return ret
}
