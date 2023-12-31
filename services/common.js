
const { querySql } = require('../utils/index');
const { decode } = require('../utils/user-jwt');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const boom = require('boom');
const {
    CODE_ERROR,
    CODE_SUCCESS,
    PRIVATE_KEY,
    JWT_EXPIRED
} = require('../utils/constant');
const moment = require('moment');



// return new token struct
const returnToken = function ({ user, successMsg, res }) {
    // 登录成功，签发一个token并返回给前端
    const { account: username, permission } = user[0] || {};
    const token = jwt.sign(
        // payload：签发的 token 里面要包含的一些数据。
        { username, permission },
        // 私钥
        PRIVATE_KEY,
        // 设置过期时间
        { expiresIn: JWT_EXPIRED }
    )
    // 登录成功，签发一个refreshToken并返回给前端
    const refreshToken = jwt.sign(
        // payload：签发的 token 里面要包含的一些数据。
        { username, permission },
        // 私钥
        PRIVATE_KEY,
        // 设置过期时间
        { expiresIn: JWT_EXPIRED * 2 }
    )

    let userData = user[0];

    res.json({
        code: CODE_SUCCESS,
        msg: successMsg,
        data: {
            token,
            refreshToken,
            userData
        }
    })
}

// select * from logistic.user_manage where account='1111';
// select * from logistic.user_manage where account=1111 and password='a5636918d403c89a6f31b67ab97d0a2a';
// INSERT * from logistic.user_manage where account=1111 and password='a5636918d403c89a6f31b67ab97d0a2a';
// query user info, return new token 
const getToken = function ({ sql, errMsg, successMsg, res }) {
    querySql(sql)
        .then(user => {
            // console.log('用户登录===', user, sql);
            if (!user || user.length === 0) {
                res.json({
                    code: CODE_ERROR,
                    msg: errMsg,
                    data: null
                })
            } else {
                returnToken({ user, successMsg, res })
            }
        })
}
// voidXsrfStacks
const voidXsrfStacks = [];
// valid Request
function validRequest(req, res, next) {
    if (voidXsrfStacks.length >= 10000) {
        voidXsrfStacks.splice(0, 5000);
    }
    return new Promise((resolve, reject) => {
        const err = validationResult(req);
        const requestId = req.get('X-requestId');
        const requestUrl = req.originalUrl;
        console.log('-------------- NEW REQUEST ------------');
        console.table({ 'requestId': requestId, 'requestTime': moment().format('YYYY-MM-DD HH:mm:ss'), requestUrl });

        const requestMsg = requestId + ':' + requestUrl;
        if (voidXsrfStacks.includes(requestMsg)) {
            const msg = 'XSRF intercept';
            res.status(406).json({
                code: CODE_ERROR,
                msg,
                data: null
            })
            // next(boom.badRequest(msg));
            reject(msg);
        } else {
            voidXsrfStacks.push(requestMsg);
        }
        // 如果验证错误，empty不为空
        console.log('--err:', err.isEmpty())
        if (!err.isEmpty()) {
            // 获取错误信息
            const [{ msg }] = err.errors;
            // 抛出错误，交给我们自定义的统一异常处理程序进行错误返回 
            next(boom.badRequest(msg));
            reject(msg);
        } else {
            try {
                const { username } = decode(req);
                console.log('username:', username);
                resolve({ username });
            } catch (error) {
                console.log('----decode fail:', error)
                resolve({});
            }

        }
    })
}

// api: get new token
function getNewTokenByRefreshToken(req, res) {
    let { refreshToken } = req.body;
    if (!refreshToken) {
        res.json({
            code: CODE_ERROR,
            msg: 'not found refreshToken in request body',
            data: null
        })
    } else {
        const { user } = decode(req, refreshToken)
        returnToken({ user: [user], successMsg: "get token success", res });
    }
}
const returnQuerySql = (dbName, fields = [], page_num = 1, page_size = 10) => {
    const sqlStart = `SELECT *
    FROM ${dbName} `;
    let sqlMain = ``;
    let otherSql = ``;
    let orderSql = ``;
    const hasQuot = ['string'];
    const otherArrayParams = [];
    const orders = [];

    fields.forEach(field => {
        const { key, val, type, isLike, isNot } = field;
        if (type === 'array' && val) {
            otherArrayParams.push({ key, val: Array.isArray(val) ? val : [val], type, isNot });
            return;
        }
        if (type === 'sortIndex') {
            orders.push(key)
            return;
        }
        if (val !== undefined) {
            if (sqlMain) {
                if (isLike && !!val) {
                    sqlMain += " AND " + key + ' LIKE ' + (hasQuot.includes(type) ? "'%" + val + "%'" : "%" + val + "%");
                } else {
                    sqlMain += " AND " + key + ' = ' + (hasQuot.includes(type) ? "'" + val + "'" : val);
                }

            } else {
                if (isLike && !!val) {
                    sqlMain += key + ' LIKE ' + (hasQuot.includes(type) ? "'%" + val + "%'" : "%" + val + "%");
                } else {
                    sqlMain += key + ' = ' + (hasQuot.includes(type) ? "'" + val + "'" : val);
                }
            }
        }
    });

    otherArrayParams.forEach(field => {
        const { key, val, isNot } = field;
        if (sqlMain || otherSql) {
            otherSql += ` AND ` + key + `${isNot ? ' NOT ' : ""} IN (${val.map(v => {
                if (typeof v === 'string') return `"${v}"`;
                return v;
            }).join(',')}) `;
        } else {
            otherSql += key + `${isNot ? ' NOT ' : ""} IN (${val.map(v => {
                if (typeof v === 'string') return `"${v}"`;
                return v;
            }).join(',')}) `;
        }
    })
    if (orders && orders.length) {
        orderSql = " ORDER BY " + orders.join(',') + " DESC "
    }
    if (sqlMain || otherSql) {
        sqlMain = ` WHERE ` + sqlMain;
    }
    return (sqlStart + sqlMain + otherSql + orderSql + ` LIMIT ${page_size} OFFSET ${page_size * (page_num - 1)};`).replace(/\n|\s+/g, ' ');
}

const returnQueryTotalSql = (dbName, fields = []) => {
    const sqlStart = `SELECT COUNT(*) 
    FROM ${dbName} `;
    let sqlMain = ``;
    let otherSql = ``;
    const hasQuot = ['string'];
    const otherParams = []
    fields.forEach(field => {
        const { key, val, type, isLike, isNot } = field;
        if (type === 'array') {
            otherParams.push({ key, val, type, isNot });
            return;
        }
        if (val !== undefined) {
            if (sqlMain) {
                if (isLike) {
                    sqlMain += "AND " + key + ' LIKE ' + (hasQuot.includes(type) ? "'%" + val + "%'" : "%" + val + "%");
                } else {
                    sqlMain += "AND " + key + ' = ' + (hasQuot.includes(type) ? "'" + val + "'" : val);
                }

            } else {
                if (isLike) {
                    sqlMain += key + ' LIKE ' + (hasQuot.includes(type) ? "'%" + val + "%'" : "%" + val + "%");
                } else {
                    sqlMain += key + ' = ' + (hasQuot.includes(type) ? "'" + val + "'" : val);
                }
            }
        }
    });

    otherParams.forEach(field => {
        const { key, val, isNot } = field;
        if (sqlMain) {
            otherSql += ` AND ` + key + `${isNot ? ' NOT ' : ""} IN (${val.map(v => {
                if (typeof v === 'string') return `"${v}"`;
                return v;
            }).join(',')}) `;
        } else {
            otherSql += key + `${isNot ? ' NOT ' : ""}  IN (${val.map(v => {
                if (typeof v === 'string') return `"${v}"`;
                return v;
            }).join(',')}) `;
        }
    })
    if (sqlMain || otherSql) {
        sqlMain = ` WHERE ` + sqlMain;
    }
    return (sqlStart + sqlMain + otherSql + `;`).replace(/\n|\s+/g, ' ');
}

module.exports = {
    getToken,
    getNewTokenByRefreshToken,
    validRequest,
    returnQuerySql,
    returnQueryTotalSql
}