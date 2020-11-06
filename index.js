const cheerio = require('cheerio')
const axios = require('axios')
const puppeteer = require('puppeteer')
const prompt = require('prompt');
const readline = require('readline')
const AsciiTable = require('ascii-table')
const fs = require('fs');



function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }))
}

async function extractPageInfo(page) {
    try {
        const html = await page.content()
        const $ = cheerio.load(html)
        const pageCount = $($("span[itemprop='numberOfPages']")[0]).text().split("pages")[0].trim()
        const authorName = $('.authorName').text()
        if (pageCount == undefined || authorName === undefined) return { pageCount: 0, authorName: undefined }
        return { pageCount, authorName }
    } catch (e) {
        console.log(e)
        process.exit(1)
    }
}

async function retrieveBooks(bookTerm, page) {
    try {
        console.log(`Loading Metadata for "${bookTerm}"...`)
        const baseUrl = `https://www.goodreads.com/search?q=${bookTerm}`
        await page.goto(baseUrl)
        const html = await page.content()
        const $ = cheerio.load(html)
        const topResult = $($(".bookTitle")[0])
        const titleName = topResult.text().trim()
        const linkLocation = topResult.attr("href")
        await page.goto('https://goodreads.com' + linkLocation, { waitUntil: "networkidle2" })
        const { pageCount, authorName } = await extractPageInfo(page)
        var table = new AsciiTable('New Book Added!')
        table
            .setHeading('Title', 'Author', 'Pages')
            .addRow(titleName, authorName, pageCount);
        console.log('\n' + table.toString() + '\n')
        return {
            titleName,
            linkLocation,
            authorName,
            pageCount: parseInt(pageCount)
        }
    } catch (e) {
        console.log(e)
        process.exit(1)
    }
}

async function generateQueue(page, bookList) {
    let bookQueue = {}
    let addMoreBooks = true
    if (bookList === undefined) {
        while (addMoreBooks) {
            const bookName = await askQuestion("Enter Book Name (n to stop): ");
            if (bookName === 'n') break
            const bookResultMetadata = await retrieveBooks(bookName, page)
            bookQueue[bookName.replace(" ", "-")] = bookResultMetadata
        }
    } else {
        for (book of bookList) {
            const bookResultMetadata = await retrieveBooks(book, page)
            bookQueue[book.replace(" ", "-")] = bookResultMetadata
        }
    }
    return bookQueue
}

async function retrieveViableDays() {
    const dayTranslation = {
        0: 'monday',
        1: 'tuesday',
        2: 'wednesday',
        3: 'thursday',
        4: 'friday',
        5: 'saturday',
        6: 'sunday'
    }

    console.log("\n\n")
    let startTime = new Date(await askQuestion('Start Date: '));
    let endTime = new Date(await askQuestion('End Date: '));

    let daysToIgnore = await askQuestion("Days to ignore (separated by comma, 'none' if none): ");
    daysToIgnore = daysToIgnore !== undefined && daysToIgnore !== 'none'
        ? daysToIgnore.split(',').map(item => item.trim().toLowerCase()) : undefined

    let totalDays = 0;
    for (let d = new Date(startTime); d <= endTime; d.setDate(d.getDate() + 1)) {
        const weekDayIdx = new Date(d).getDay()
        if (!daysToIgnore.includes(dayTranslation[weekDayIdx])) {
            totalDays++
        }
    }
    return { totalDays, 'start': startTime, 'end': endTime }
}

function computeGoalDays(bookQueue, startTime, endTime, dailyPgCount) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    let goals = {}

    const queueKeys = Object.keys(bookQueue)
    for (let d = startTime; d <= endTime; d.setDate(d.getDate() + 1)) {
        const currentBook = bookQueue[queueKeys[0]]
        const pgCount = currentBook.pageCount - dailyPgCount
        if (pgCount <= 0) {
            goals[currentBook.titleName] = new Date(d).toLocaleDateString(undefined, options)
            queueKeys.shift()
            if (queueKeys.length == 0) return goals
            bookQueue[queueKeys[0]].pageCount += pgCount
        } else {
            bookQueue[queueKeys[0]].pageCount -= dailyPgCount
        }
    }
    return goals
}

async function main() {
    const browser = await puppeteer.launch({ headless: true })
    const page = await browser.newPage()
    console.log('\n\n')

    let bookList = undefined
    const loadFile = await askQuestion('Do you want to load book list from file? ')
    if (loadFile == 'y') {
        const filePath = await askQuestion('Enter Path of Book CSV: ')
        bookList = fs.readFileSync(filePath, 'utf8').split(',').map(item => item.trim())
    }

    const bookQueue = await generateQueue(page, bookList)
    const { totalDays, start, end } = await retrieveViableDays()
    const totalPages = Object.keys(bookQueue).map(book => bookQueue[book].pageCount).reduce((sum, key) => sum + key)

    var table = new AsciiTable('Statistics')
    table
        .setHeading('Days Remaining', 'Total Books', 'Total Pages', 'Pages/Day')
        .addRow(totalDays, Object.keys(bookQueue).length, totalPages, Math.ceil(totalPages / totalDays));
    console.log('\n' + table.toString() + '\n')

    var completionTable = new AsciiTable('Goal Dates')
    completionTable
        .setHeading('Book Title', 'Completion Date')
    const estimatedCompletionTimes = computeGoalDays(bookQueue, new Date(start), new Date(end), Math.ceil(totalPages / totalDays))
    Object.keys(estimatedCompletionTimes).map(bookObject => {
        completionTable.addRow(bookObject, estimatedCompletionTimes[bookObject])
    })
    console.log('\n' + completionTable.toString() + '\n')
    process.exit(1)
}

main()