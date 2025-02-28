import { Message } from '@rocket.chat/core-services';
import type { IRoom } from '@rocket.chat/core-typings';
import { Rooms, Subscriptions, Users } from '@rocket.chat/models';
import type { ServerMethods } from '@rocket.chat/ui-contexts';
import { Match, check } from 'meteor/check';
import { Meteor } from 'meteor/meteor';

import { hasPermissionAsync } from '../../app/authorization/server/functions/hasPermission';
import { RoomMemberActions } from '../../definition/IRoomTypeConfig';
import { callbacks } from '../../lib/callbacks';
import { roomCoordinator } from '../lib/rooms/roomCoordinator';

declare module '@rocket.chat/ui-contexts' {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	interface ServerMethods {
		unmuteUserInRoom(data: { rid: IRoom['_id']; username: string }): boolean;
	}
}

export const unmuteUserInRoom = async (fromId: string, data: { rid: IRoom['_id']; username: string }): Promise<boolean> => {
	if (!fromId || !(await hasPermissionAsync(fromId, 'mute-user', data.rid))) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', {
			method: 'unmuteUserInRoom',
		});
	}

	const room = await Rooms.findOneById(data.rid);

	if (!room) {
		throw new Meteor.Error('error-invalid-room', 'Invalid room', {
			method: 'unmuteUserInRoom',
		});
	}

	if (!(await roomCoordinator.getRoomDirectives(room.t).allowMemberAction(room, RoomMemberActions.MUTE, fromId))) {
		throw new Meteor.Error('error-invalid-room-type', `${room.t} is not a valid room type`, {
			method: 'unmuteUserInRoom',
			type: room.t,
		});
	}

	const subscription = await Subscriptions.findOneByRoomIdAndUsername(data.rid, data.username, {
		projection: { _id: 1 },
	});

	if (!subscription) {
		throw new Meteor.Error('error-user-not-in-room', 'User is not in this room', {
			method: 'unmuteUserInRoom',
		});
	}

	const unmutedUser = await Users.findOneByUsernameIgnoringCase(data.username);
	if (!unmutedUser?.username) {
		throw new Meteor.Error('error-invalid-user', 'Invalid user to unmute', {
			method: 'unmuteUserInRoom',
		});
	}

	const fromUser = await Users.findOneById(fromId);
	if (!fromUser) {
		throw new Meteor.Error('error-invalid-user', 'Invalid user', {
			method: 'unmuteUserInRoom',
		});
	}

	await callbacks.run('beforeUnmuteUser', { unmutedUser, fromUser }, room);

	await Rooms.unmuteUsernameByRoomId(data.rid, unmutedUser.username);

	await Message.saveSystemMessage('user-unmuted', data.rid, unmutedUser.username, fromUser);

	setImmediate(() => {
		void callbacks.run('afterUnmuteUser', { unmutedUser, fromUser }, room);
	});

	return true;
};

Meteor.methods<ServerMethods>({
	async unmuteUserInRoom(data) {
		const fromId = Meteor.userId();

		check(
			data,
			Match.ObjectIncluding({
				rid: String,
				username: String,
			}),
		);

		if (!fromId) {
			throw new Meteor.Error('error-not-allowed', 'Not allowed', {
				method: 'unmuteUserInRoom',
			});
		}

		return unmuteUserInRoom(fromId, data);
	},
});
