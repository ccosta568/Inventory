"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVENT_META_GSI_SK = void 0;
exports.ownerPartition = ownerPartition;
exports.bookPartition = bookPartition;
exports.bookSortKey = bookSortKey;
exports.eventPartition = eventPartition;
exports.eventSortKey = eventSortKey;
exports.eventLinePartition = eventLinePartition;
exports.eventLineSortKey = eventLineSortKey;
exports.gsiEventMeta = gsiEventMeta;
exports.gsiBookEvent = gsiBookEvent;
const DEFAULT_OWNER = 'public';
function ownerPartition(ownerId) {
    return ownerId ? ownerId : DEFAULT_OWNER;
}
function bookPartition(ownerId) {
    return `BOOK#${ownerPartition(ownerId)}`;
}
function bookSortKey(bookId) {
    return `BOOK#${bookId}`;
}
function eventPartition(ownerId) {
    return `EVENT#${ownerPartition(ownerId)}`;
}
function eventSortKey(dateIso, eventId) {
    return `EVENT#${dateIso}#${eventId}`;
}
function eventLinePartition(ownerId, eventId) {
    return `EVENTLINE#${ownerPartition(ownerId)}#${eventId}`;
}
function eventLineSortKey(index, bookId) {
    return `LINE#${index.toString().padStart(4, '0')}#${bookId}`;
}
function gsiEventMeta(ownerId, eventId) {
    return `EVENT#${ownerPartition(ownerId)}#${eventId}`;
}
function gsiBookEvent(ownerId, bookId) {
    return `BOOK#${ownerPartition(ownerId)}#${bookId}`;
}
exports.EVENT_META_GSI_SK = 'META';
