import fetch from "node-fetch"
import dotenv from "dotenv"
import { createObjectCsvWriter as createCsvWriter } from "csv-writer"

// Load .env
dotenv.config()

const CONFIG = {
    username: process.env.INVOICE_SIMPLE_USERNAME,
    password: process.env.INVOICE_SIMPLE_PASSWORD,
}

if (!CONFIG.username) throw new Error("INVOICE_SIMPLE_USERNAME Is Not Defined")
if (!CONFIG.password) throw new Error("INVOICE_SIMPLE_PASSWORD Is Not Defined")

console.info("Logging In")
const loginState = await fetch(
    "https://api.getinvoicesimple.com/api/v3/app/login",
    {
        method: "POST",
        headers: {
            accept: "application/json, text/plain, */*",
            "content-type": "application/json",
            "x-is-platform": "web",
            "x-is-app": "app.invoicesimple.com",
            "x-is-version": "779.0.0-production",
            "x-is-installation": "c8ffcd60-af98-11ec-9ee6-d5081be09e98",
        },
        body: JSON.stringify({
            username: CONFIG.username,
            password: CONFIG.password,
            installation: {
                locale: "en-US",
                appName: "app.invoicesimple.com",
                os: "Linux x86_64",
                device: "desktop",
                appsflyerId: "web",
                parseVersion: "js2.10.0",
            },
        }),
    },
).then((r) => r.json())
if (!loginState.succeeded) throw new Error("Could Not Login")

async function getDocuments(startingPageUrl) {
    return await fetch(startingPageUrl, {
        method: "GET",
        headers: {
            accept: "application/json, text/plain, */*",
            "x-parse-session-token": loginState.session.sessionToken,
        },
    }).then((r) => r.json())
}

const documents = await getDocuments(
    "https://app.invoicesimple.com/api/docs?doctype=0&dir=desc&sortby=invoiceDate&limit=50",
)

// Handle Pagination
while (documents.hasNextPage === true) {
    const nextDocuments = await getDocuments(documents.next)
    documents.documents = [...documents.documents, ...nextDocuments.documents]
    documents.prev = nextDocuments.prev
    documents.next = nextDocuments.next
    documents.hasNextPage = nextDocuments.hasNextPage
}

async function getInvoice(objectId) {
    return await fetch(
        "https://data.getinvoicesimple.com/parse/classes/Invoice",
        {
            method: "POST",
            headers: {
                accept: "application/json, text/plain, */*",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                where: {
                    objectId: objectId,
                },
                limit: 1,
                _method: "GET",
                _ApplicationId: "F8pgJyHm8jxQhXxYnpdEzBTxLP2Nhu68JLtmek3y",
                _ClientVersion: "js2.10.0",
                _InstallationId: "3719d178-b899-43a0-867b-cb951b1792ac",
                _SessionToken: loginState.session.sessionToken,
            }),
        },
    ).then((r) => r.json())
}

const pendingInvoices = documents.documents.map((document) =>
    getInvoice(document.objectId),
)

console.info("Getting All Invoices")
const invoices = await Promise.all(pendingInvoices)

const invoicesFormatted = invoices.map(({ results }) => {
    const invoice = results[0]
    return {
        invoiceNumber: invoice.invoiceNo,
        invoiceTotal: invoice.total,
        invoiceDue: invoice.balanceDue,
        clientName: invoice.client.name,
        invoiceNotes: invoice.setting.comment,
    }
})

console.info("Saving CSV")
const csvWriter = createCsvWriter({
    path: "./invoicesimple-export.csv",
    header: [
        { id: "invoiceNumber", title: "Invoice Number" },
        { id: "invoiceTotal", title: "Invoice Total" },
        { id: "invoiceDue", title: "Invoice Balance Due" },
        { id: "clientName", title: "Invoice Client Name" },
        { id: "invoiceNotes", title: "Invoice Notes" },
    ],
})

csvWriter.writeRecords(invoicesFormatted).then(() => {
    console.log("Finished Export: invoicesimple-export.csv")
})
