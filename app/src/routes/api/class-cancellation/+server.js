import { prisma } from '$lib/postgres.js';
import { json, error } from '@sveltejs/kit';
import { sendMIMEmessage } from '$lib/server/gmailEmailFactory';
import { DateTime } from 'luxon';
import { INTERNAL_API_KEY } from '$lib/server/secrets';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {

    const result = await request.json();

    let apiKey;
    try {
        apiKey = result.customParameters.apiKey;
    } catch (e) {
        return new Response(error(400));
    }

    if (apiKey !== INTERNAL_API_KEY) {
        return new Response(error(401, 'Unauthorized'));
    }

    const status = result.data.tickets[0].attendees[0].registrationStatus;

    if (status !== 'CANCELED' && status !== 'REFUNDED') {
        return new Response(json({ success: true, updated: false }));
    }

    const eventId = parseInt(result.data.eventId);

    const eventInstanceDecrementCall = prisma.NeonEventInstance.update({
        where: {
            eventId: eventId
        },
        data: {
            attendeeCount: {
                decrement: 1
            }
        },
        include: {
            eventType: {
                select: {
                    name: true
                }
            },
            requester: true
        }
    })

    const baseRegLinkCall = prisma.NeonBaseRegLink.findFirst({
        select: {
            url: true
        }
    });

    let [eventInstanceDecrement, baseRegLink] = await prisma.$transaction([eventInstanceDecrementCall, baseRegLinkCall]);

    if (eventInstanceDecrement.requester.length > 0) {

        const startDateTime = DateTime.fromJSDate(eventInstanceDecrement.startDateTime).setZone('utc').toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY);

        const emailList = [];

        for (const requester of eventInstanceDecrement.requester) {
            const email = requester.email;

            const emailBody = `
            <div>
            <p>Hi ${requester.firstName},</p>
            <p>A seat has opened up in ${eventInstanceDecrement.eventType.name} on ${startDateTime}.</p>
            <p>If you are interested in attending, please use <a href="${baseRegLink.url}${eventId}">this link</a> to register through Neon.</p>
            <p>As a reminder, seats are first come first served.</p>
            <p><b>Please note:</b> If someone else has already registered and taken the open seat, Neon will still allow you to "register" and join Neon's waitlist system without
            paying for the class. This means that you are not a confirmed student, and you will not be able to join this session. If Neon collects your registration fee and you 
            receive an event registration confirmation email, you are a confirmed student.</p>
            <p>If you have any questions, feel free to reply to this email.</p>
            <p>Best, <br>Asmbly Education Team</p>
            </div>
            `

            const response = sendMIMEmessage({
                from: 'Asmbly Education Team <notification@asmbly.org>',
                to: email,
                replyTo: 'membership@asmbly.org',
                subject: `Open seat in ${eventInstanceDecrement.eventType.name} at Asmbly`,
                html: emailBody
            })

            emailList.push(response);
        }

        await Promise.all(emailList);
    }

	return new Response(json({ success: true }));

}