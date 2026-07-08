var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
function getTarget(req) {
    var _a;
    var raw = (_a = req.query) === null || _a === void 0 ? void 0 : _a.target;
    var value = Array.isArray(raw) ? raw[0] : raw;
    if (!value)
        throw new Error('Missing target query parameter for RPC proxy.');
    var target = new URL(value);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        throw new Error("Unsupported RPC target protocol: ".concat(target.protocol));
    }
    return target;
}
function readBody(req) {
    return __awaiter(this, void 0, void 0, function () {
        var chunks, stream, _a, stream_1, stream_1_1, chunk, e_1_1;
        var _b, e_1, _c, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    if (!req[Symbol.asyncIterator])
                        return [2 /*return*/, undefined];
                    chunks = [];
                    stream = req;
                    _e.label = 1;
                case 1:
                    _e.trys.push([1, 6, 7, 12]);
                    _a = true, stream_1 = __asyncValues(stream);
                    _e.label = 2;
                case 2: return [4 /*yield*/, stream_1.next()];
                case 3:
                    if (!(stream_1_1 = _e.sent(), _b = stream_1_1.done, !_b)) return [3 /*break*/, 5];
                    _d = stream_1_1.value;
                    _a = false;
                    chunk = _d;
                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                    _e.label = 4;
                case 4:
                    _a = true;
                    return [3 /*break*/, 2];
                case 5: return [3 /*break*/, 12];
                case 6:
                    e_1_1 = _e.sent();
                    e_1 = { error: e_1_1 };
                    return [3 /*break*/, 12];
                case 7:
                    _e.trys.push([7, , 10, 11]);
                    if (!(!_a && !_b && (_c = stream_1.return))) return [3 /*break*/, 9];
                    return [4 /*yield*/, _c.call(stream_1)];
                case 8:
                    _e.sent();
                    _e.label = 9;
                case 9: return [3 /*break*/, 11];
                case 10:
                    if (e_1) throw e_1.error;
                    return [7 /*endfinally*/];
                case 11: return [7 /*endfinally*/];
                case 12: return [2 /*return*/, chunks.length ? Buffer.concat(chunks) : undefined];
            }
        });
    });
}
export default function handler(req, res) {
    return __awaiter(this, void 0, void 0, function () {
        var target, body, _a, upstream, _b, _c, error_1;
        var _d, _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    res.setHeader('Cache-Control', 'no-store');
                    _f.label = 1;
                case 1:
                    _f.trys.push([1, 7, , 8]);
                    target = getTarget(req);
                    if (!(req.method === 'GET' || req.method === 'HEAD')) return [3 /*break*/, 2];
                    _a = undefined;
                    return [3 /*break*/, 4];
                case 2: return [4 /*yield*/, readBody(req)];
                case 3:
                    _a = _f.sent();
                    _f.label = 4;
                case 4:
                    body = _a;
                    return [4 /*yield*/, fetch(target, {
                            method: (_d = req.method) !== null && _d !== void 0 ? _d : 'POST',
                            headers: {
                                'Content-Type': typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : 'application/json',
                            },
                            body: body ? new Uint8Array(body) : undefined,
                        })];
                case 5:
                    upstream = _f.sent();
                    res.status(upstream.status);
                    res.setHeader('Content-Type', (_e = upstream.headers.get('content-type')) !== null && _e !== void 0 ? _e : 'application/json');
                    _c = (_b = res).send;
                    return [4 /*yield*/, upstream.text()];
                case 6:
                    _c.apply(_b, [_f.sent()]);
                    return [3 /*break*/, 8];
                case 7:
                    error_1 = _f.sent();
                    res.status(502);
                    res.setHeader('Content-Type', 'application/json');
                    res.send(JSON.stringify({
                        error: 'Fiber RPC proxy failed.',
                        detail: error_1.message,
                    }));
                    return [3 /*break*/, 8];
                case 8: return [2 /*return*/];
            }
        });
    });
}
