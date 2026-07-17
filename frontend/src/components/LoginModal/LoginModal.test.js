import React from "react";
import { shallow } from "enzyme";
import LoginModal from "./LoginModal";

describe("LoginModal", () => {
  test("matches snapshot", () => {
    const wrapper = shallow(<LoginModal />);
    expect(wrapper).toMatchSnapshot();
  });
});
