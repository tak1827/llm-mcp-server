export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const sleepCancelable = (ms: number, onCancel: (clearTimer: () => void) => void) => {
	return new Promise<void>((resolve, reject) => {
		const t = setTimeout(resolve, ms);
		// give the caller a way to cancel
		onCancel(() => {
			clearTimeout(t);
			reject(new Error("sleep cancelled")); // <— unblock the sleeper
		});
	});
};

